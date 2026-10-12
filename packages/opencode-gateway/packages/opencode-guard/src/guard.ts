/**
 * Pure guard logic for @heretek-ai/gateway-guard (no @opencode/* imports so
 * this module is unit-testable under `bun test` without the host).
 *
 * Policy: raw network tools (fetch/curl/wget/http, interpreter exfil
 * primitives, shells carrying fetch intent) are BLOCKED toward arbitrary
 * URLs. Calls whose every URL targets the allowlisted gateway host pass, so
 * agents can still reach the hardened gateway directly.
 */

export interface GuardConfig {
  /** Host allowlist. Defaults to the host of GATEWAY_URL / gateway:8000. */
  allowedHosts?: string[];
  gatewayUrl?: string;
}

export function defaultGatewayUrl(): string {
  try {
    return process.env["GATEWAY_URL"] ?? "http://gateway:8000";
  } catch {
    return "http://gateway:8000";
  }
}

export function allowedHostsFor(config: GuardConfig = {}): string[] {
  if (config.allowedHosts && config.allowedHosts.length > 0) {
    return config.allowedHosts.map((h) => h.toLowerCase());
  }
  const raw = config.gatewayUrl ?? defaultGatewayUrl();
  try {
    return [new URL(raw).hostname.toLowerCase()];
  } catch {
    return ["gateway"];
  }
}

function normalizeToolName(tool: string): string {
  return (tool || "").toLowerCase().replace(/[-_\s]/g, "");
}

// Shell-like hosts whose ARGS are inspected for exfil intent (not blocked
// outright so plain `ls` keeps working).
const SHELL_TOOLS = new Set(["bash", "shell", "exec", "command", "terminal", "sh", "zsh"]);

// Direct-tool substring blocklist (normalized). Long tokens use substring so
// versioned variants (python3, powershell.exe) still match.
const BLOCKED_TOOL_SUBSTRINGS = [
  "fetch",
  "http",
  "curl",
  "wget",
  "python",
  "powershell",
  "pwsh",
  "httprequest",
  "socket",
  "netcat",
  "ruby",
  "perl",
  "lua",
  "node",
];

// Exact-match blocklist for short names where substring would false-positive
// (e.g. "nc" inside "sync").
const BLOCKED_TOOL_EXACT = new Set(["cmd", "cmd.exe", "nc", "ncat"]);

function stripExeSuffix(normalized: string): string {
  return normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized;
}

export function isBlockedToolName(tool: string): boolean {
  const normalized = normalizeToolName(tool);
  const base = stripExeSuffix(normalized);
  for (const part of BLOCKED_TOOL_SUBSTRINGS) {
    if (base.includes(part)) return true;
  }
  if (BLOCKED_TOOL_EXACT.has(normalized) || BLOCKED_TOOL_EXACT.has(base)) return true;
  return false;
}

const URL_IN_ARGS_RE = /https?:\/\/[^\s"'<>\\]+/gi;

export function extractHosts(args: unknown): string[] {
  let blob: string;
  try {
    blob = JSON.stringify(args ?? {});
  } catch {
    return [];
  }
  const hosts: string[] = [];
  for (const m of blob.matchAll(URL_IN_ARGS_RE)) {
    try {
      hosts.push(new URL(m[0]).hostname.toLowerCase());
    } catch {
      // ignore unparseable
    }
  }
  return hosts;
}

/** True when args reference at least one URL outside the allowlist. */
export function touchesArbitraryUrl(args: unknown, allowedHosts: string[]): boolean {
  const hosts = extractHosts(args);
  return hosts.some((h) => !allowedHosts.includes(h));
}

/** True when args carry interpreter/exfil markers (regardless of URL). */
export function shellArgsLookLikeExfil(args: unknown): boolean {
  let blob: string;
  try {
    blob = JSON.stringify(args ?? {}).toLowerCase();
  } catch {
    return false;
  }
  if (
    blob.includes("curl") ||
    blob.includes("wget") ||
    blob.includes("http://") ||
    blob.includes("https://") ||
    blob.includes("webfetch") ||
    blob.includes("httprequest") ||
    blob.includes("http_request")
  )
    return true;
  if (
    blob.includes("python") ||
    blob.includes("powershell") ||
    blob.includes("pwsh") ||
    blob.includes("invoke-webrequest") ||
    blob.includes("invoke-restmethod")
  )
    return true;
  if (blob.includes("/dev/tcp") || blob.includes("socket") || blob.includes("base64")) return true;
  if (/(?:^|[^a-z0-9])b64(?:[^a-z0-9]|$)/.test(blob)) return true;
  if (blob.includes("netcat") || blob.includes("ncat")) return true;
  if (/(?:^|[^a-z])nc(?:[^a-z]|$)/.test(blob)) return true;
  if (/(?:^|[^a-z])cmd(?:\.exe)?(?:[^a-z]|$)/.test(blob)) return true;
  return false;
}

export function blockedMessage(tool: string): string {
  // Generic on purpose: never echo URLs (they may carry secrets in query).
  return (
    `[Gateway Guard] Direct network access via tool '${tool}' is blocked by security policy. ` +
    `Use the opencode-gateway MCP tools (search, fetch, extract_structured, research_report) so traffic ` +
    `flows through SSRF filtering, egress controls, and audit.`
  );
}

export interface GuardDecision {
  blocked: boolean;
  message?: string;
}

/**
 * Decides a `tool.execute.before` call. Pure: (tool, args, config) -> decision.
 * The plugin host throws Error(message) when blocked.
 */
export function decideToolExecution(tool: string, args: unknown, config: GuardConfig = {}): GuardDecision {
  const allowed = allowedHostsFor(config);
  const normalized = normalizeToolName(tool);
  if (isBlockedToolName(tool)) {
    // Gateway-only carve-out: a fetch-class tool pointed solely at the
    // gateway host is the sanctioned path, not a bypass.
    if (!touchesArbitraryUrl(args, allowed) && extractHosts(args).length > 0) return { blocked: false };
    return { blocked: true, message: blockedMessage(tool) };
  }
  if (SHELL_TOOLS.has(normalized)) {
    if (shellArgsLookLikeExfil(args) && touchesArbitraryUrl(args, allowed)) {
      return { blocked: true, message: blockedMessage(tool) };
    }
  }
  return { blocked: false };
}
