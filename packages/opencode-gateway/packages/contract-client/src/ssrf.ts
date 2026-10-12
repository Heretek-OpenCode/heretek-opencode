import { isIP } from "node:net";

/**
 * Fail-closed SSRF guard (pure functions — no DNS, no network).
 *
 * Policy: only globally-routable targets are allowed. Everything else
 * (loopback, RFC1918, CGNAT, link-local/metadata, multicast, reserved,
 * unspecified, localhost) is denied. Mirrors the Python `ssrf_guard`
 * semantics from scraper-swarm, ported to dependency-free TypeScript.
 */

export const MAX_URL_LENGTH = 2048;

type V4Tuple = [number, number, number, number];

function v4InCidr(ip: V4Tuple, base: V4Tuple, bits: number): boolean {
  const toInt = (t: V4Tuple): number =>
    ((t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]) >>> 0;
  if (bits === 0) return true;
  const mask = ((0xffffffff << (32 - bits)) >>> 0) as number;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}

const V4_BLOCKED: Array<{ base: V4Tuple; bits: number; label: string }> = [
  { base: [0, 0, 0, 0], bits: 8, label: "unspecified (0.0.0.0/8)" },
  { base: [10, 0, 0, 0], bits: 8, label: "RFC1918 (10.0.0.0/8)" },
  { base: [100, 64, 0, 0], bits: 10, label: "CGNAT (100.64.0.0/10)" },
  { base: [127, 0, 0, 0], bits: 8, label: "loopback (127.0.0.0/8)" },
  { base: [169, 254, 0, 0], bits: 16, label: "link-local/metadata (169.254.0.0/16)" },
  { base: [172, 16, 0, 0], bits: 12, label: "RFC1918 (172.16.0.0/12)" },
  { base: [192, 0, 2, 0], bits: 24, label: "documentation (192.0.2.0/24)" },
  { base: [192, 168, 0, 0], bits: 16, label: "RFC1918 (192.168.0.0/16)" },
  { base: [198, 18, 0, 0], bits: 15, label: "benchmark (198.18.0.0/15)" },
  { base: [198, 51, 100, 0], bits: 24, label: "documentation (198.51.100.0/24)" },
  { base: [203, 0, 113, 0], bits: 24, label: "documentation (203.0.113.0/24)" },
  { base: [224, 0, 0, 0], bits: 4, label: "multicast (224.0.0.0/4)" },
  { base: [240, 0, 0, 0], bits: 4, label: "reserved (240.0.0.0/4)" },
];

function parseHexOrDec(part: string): number | null {
  const lowered = part.toLowerCase();
  try {
    if (lowered.startsWith("0x") && lowered.length > 2) {
      const v = parseInt(lowered.slice(2), 16);
      return Number.isInteger(v) && v >= 0 && v <= 255 ? v : null;
    }
    if (part.length > 1 && part.startsWith("0") && /^[0-7]+$/.test(part)) {
      const v = parseInt(part, 8);
      return v >= 0 && v <= 255 ? v : null;
    }
    if (/^\d+$/.test(part)) {
      const v = parseInt(part, 10);
      return v >= 0 && v <= 255 ? v : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalizes an IPv4 literal in decimal/octal/hex/dword/shortened encodings
 * to a 4-tuple. Returns null when the host is not a numeric literal
 * (i.e. it is a DNS name, handled by the DNS-pin layer).
 */
export function normalizeIPv4Literal(host: string): V4Tuple | null {
  const cleaned = host.trim().replace(/\.+$/, "");
  if (!cleaned || cleaned.includes(":")) return null;
  if (!/^[0-9a-fA-Fx.]+$/.test(cleaned)) return null;
  if (!cleaned.includes(".")) {
    const lowered = cleaned.toLowerCase();
    let dword: number | null = null;
    if (lowered.startsWith("0x") && lowered.length > 2) dword = parseInt(lowered.slice(2), 16);
    else if (cleaned.length > 1 && cleaned.startsWith("0") && /^\d+$/.test(cleaned)) dword = parseInt(cleaned, 8);
    else if (/^\d+$/.test(cleaned)) dword = parseInt(cleaned, 10);
    if (dword === null || !Number.isInteger(dword) || dword < 0 || dword > 0xffffffff) return null;
    return [(dword >>> 24) & 0xff, (dword >>> 16) & 0xff, (dword >>> 8) & 0xff, dword & 0xff];
  }
  const parts = cleaned.split(".");
  if (parts.length === 4) {
    const vals = parts.map(parseHexOrDec);
    if (vals.some((v) => v === null)) return null;
    return vals as V4Tuple;
  }
  if (parts.length === 2 || parts.length === 3) {
    // inet_aton shortened forms: last part widens.
    const width = parts.length === 3 ? 16 : 24;
    const head = parts.slice(0, -1).map(parseHexOrDec);
    if (head.some((v) => v === null)) return null;
    const tailRaw = parts[parts.length - 1].toLowerCase();
    let tail: number | null = null;
    if (tailRaw.startsWith("0x") && tailRaw.length > 2) tail = parseInt(tailRaw.slice(2), 16);
    else if (parts[parts.length - 1].length > 1 && parts[parts.length - 1].startsWith("0") && /^\d+$/.test(parts[parts.length - 1])) {
      tail = parseInt(parts[parts.length - 1], 8);
    } else if (/^\d+$/.test(parts[parts.length - 1])) tail = parseInt(parts[parts.length - 1], 10);
    if (tail === null || tail < 0 || tail > (1 << width) - 1) return null;
    const tailBytes: number[] = [];
    for (let i = width / 8 - 1; i >= 0; i--) tailBytes.push((tail >>> (i * 8)) & 0xff);
    return [...(head as number[]), ...tailBytes].slice(-4) as unknown as V4Tuple;
  }
  return null;
}

function expandIPv6(ip: string): bigint | null {
  // Returns the 128-bit value, or null when unparseable.
  try {
    let addr = ip;
    // Expand an embedded IPv4 tail (e.g. ::ffff:127.0.0.1) into two hextets.
    const v4tail = /\.(\d+)$/.exec(addr);
    if (addr.includes(".") && v4tail) {
      const lastColon = addr.lastIndexOf(":");
      const v4part = addr.slice(lastColon + 1);
      const v4 = normalizeIPv4Literal(v4part);
      if (!v4) return null;
      const hi = ((v4[0] << 8) | v4[1]).toString(16);
      const lo = ((v4[2] << 8) | v4[3]).toString(16);
      addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
    }
    if (isIP(addr) !== 6 && !/^[0-9a-fA-F:]+$/.test(addr)) return null;
    const halves = addr.split("::");
    if (halves.length > 2) return null;
    const parse = (s: string): number[] | null => {
      if (s === "") return [];
      const gs = s.split(":");
      const out: number[] = [];
      for (const g of gs) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
      return out;
    };
    let groups: number[];
    if (halves.length === 1) {
      const g = parse(halves[0]);
      if (!g || g.length !== 8) return null;
      groups = g;
    } else {
      const h = parse(halves[0]);
      const t = parse(halves[1]);
      if (!h || !t) return null;
      const zeros = 8 - h.length - t.length;
      if (zeros < 0) return null;
      groups = [...h, ...Array.from({ length: zeros }, () => 0), ...t];
    }
    if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
    return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
  } catch {
    return null;
  }
}

const V6_BLOCKED: Array<{ base: string; bits: number; label: string }> = [
  { base: "::1", bits: 128, label: "loopback (::1/128)" },
  { base: "::", bits: 128, label: "unspecified (::/128)" },
  { base: "fe80::", bits: 10, label: "link-local (fe80::/10)" },
  { base: "fc00::", bits: 7, label: "unique-local (fc00::/7)" },
  { base: "ff00::", bits: 8, label: "multicast (ff00::/8)" },
  { base: "::ffff:0:0", bits: 96, label: "ipv4-mapped (::ffff:0:0/96)" },
];

/** True when a literal IP string is NOT globally routable (must be blocked). */
export function isBlockedIp(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  const kind = isIP(trimmed);
  if (kind === 4) {
    const t = trimmed.split(".").map(Number) as V4Tuple;
    return V4_BLOCKED.some((c) => v4InCidr(t, c.base, c.bits));
  }
  if (kind === 6) {
    const val = expandIPv6(trimmed);
    if (val === null) return true; // unparseable -> fail closed
    for (const c of V6_BLOCKED) {
      if (c.bits === 128) {
        const base = expandIPv6(c.base);
        if (base !== null && val === base) return true;
        continue;
      }
      const base = expandIPv6(c.base);
      if (base === null) continue;
      const shift = 128n - BigInt(c.bits);
      if ((val >> shift) === (base >> shift)) return true;
    }
    // ::ffff:a.b.c.d mapped literals: check the embedded v4 too.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
    if (mapped) {
      const v4 = normalizeIPv4Literal(mapped[1]);
      if (!v4) return true;
      return V4_BLOCKED.some((c) => v4InCidr(v4, c.base, c.bits));
    }
    return false;
  }
  // Encoded dword/hex/octal/shortened IPv4 literals.
  const v4 = normalizeIPv4Literal(trimmed);
  if (v4) return V4_BLOCKED.some((c) => v4InCidr(v4, c.base, c.bits));
  return true; // not a numeric literal (DNS name or garbage) -> fail closed here; the DNS-pin layer decides names
}

/** True when a hostname must be blocked without DNS (localhost, literals). */
export function isBlockedHost(host: string): boolean {
  const h = host.trim().replace(/\.+$/, "").toLowerCase();
  if (!h) return true;
  if (h === "localhost") return true;
  if (isIP(h) !== 0) return isBlockedIp(h);
  // Any numeric-encoding literal (dword, hex, octal, shortened).
  if (/^[0-9a-fx.]+$/i.test(h) && normalizeIPv4Literal(h) !== null) {
    return isBlockedIp(h);
  }
  return false; // DNS name -> resolved + pinned by the async layer
}

/** WHATWG differentials: ASCII tabs/newlines are stripped by browsers before
 * parsing (smuggling a loopback host past naive parsers), and backslash acts
 * as a path delimiter. Deny C0 controls, DEL, and backslash outright. */
function hasForbiddenUrlChars(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c < 32 || c === 127 || c === 92) return true;
  }
  return false;
}

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Synchronous fail-closed pre-check (no DNS). Returns a denial reason, or
 * null when the URL passes the literal layer. DNS names that are not
 * localhost always pass here and MUST go through `assertHostResolvesPublic`
 * (DNS pin) before any fetch.
 */
export function denyReasonForUrl(url: string): string | null {
  if (url.length > MAX_URL_LENGTH) return `URL longer than ${MAX_URL_LENGTH} characters (fail-closed)`;
  if (hasForbiddenUrlChars(url)) return "URL contains forbidden characters (fail-closed)";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unparseable URL (fail-closed)";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `unsupported scheme '${parsed.protocol.replace(/:$/, "") || "(none)"}' (fail-closed)`;
  }
  const host = (parsed.hostname ?? "").trim().replace(/\.+$/, "");
  if (!host) return "empty hostname (fail-closed)";
  if (isBlockedHost(host)) {
    if (host.toLowerCase() === "localhost") return "localhost resolves to loopback (fail-closed)";
    return `host '${host}' is not globally routable (fail-closed)`;
  }
  return null;
}

/**
 * DNS-pin layer: resolves `host` with `resolve` (injectable for tests) and
 * denies when EVERY address is unresolvable (fail-closed) or ANY address is
 * non-routable. `resolve` must return string IPs; empty = unresolvable.
 */
export async function assertHostResolvesPublic(
  host: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<string | null> {
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    return `host '${host}' DNS resolution failed (fail-closed)`;
  }
  if (!addrs || addrs.length === 0) return `host '${host}' unresolvable (fail-closed)`;
  for (const a of addrs) {
    const kind = isIP(a.trim().replace(/^\[|\]$/g, ""));
    if (kind === 0) return `host '${host}' resolved to unparseable address (fail-closed)`;
    if (isBlockedIp(a)) return `host '${host}' resolves to non-routable addresses (fail-closed)`;
  }
  return null;
}

/** Full check: literal layer + DNS pin. Null = allowed. */
export async function checkUrlAllowed(
  url: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<string | null> {
  const literal = denyReasonForUrl(url);
  if (literal) return literal;
  const host = extractHostname(url);
  if (!host) return "empty hostname (fail-closed)";
  if (isBlockedHost(host)) return `host '${host}' is not globally routable (fail-closed)`;
  return assertHostResolvesPublic(host, resolve);
}
