// POSIX loopback capability manager (zero-Python).
// Generates dual independent 32-byte CSPRNG tokens, stores them atomically
// with 0600, and audits ancestor permissions / symlinks.

import { getRandomValues } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface Capabilities {
  readonly httpCapability: string;
  readonly wsCapability: string;
}

const HTTP_RE = /^[A-Za-z0-9._~+/=-]{32,128}$/;
const WS_RE = /^[0-9a-f]{64}$/;

function randomHexBytes(count: number): string {
  const buf = getRandomValues(new Uint8Array(count));
  return Buffer.from(buf).toString("hex");
}

function randomUrlSafeBytes(count: number): string {
  const buf = getRandomValues(new Uint8Array(count));
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function validateHttpCapability(value: string): string {
  if (typeof value !== "string" || !HTTP_RE.test(value)) {
    throw new Error("http capability must be 32-128 bearer-token characters");
  }
  return value;
}

export function validateWsCapability(value: string): string {
  if (typeof value !== "string" || !WS_RE.test(value)) {
    throw new Error("ws capability must be 64 lowercase hex digits");
  }
  return value;
}

export function validateCapabilities(caps: Capabilities): Capabilities {
  validateHttpCapability(caps.httpCapability);
  validateWsCapability(caps.wsCapability);
  if (caps.httpCapability === caps.wsCapability) {
    throw new Error("http and ws capabilities must be independent");
  }
  return caps;
}

export function generateCapabilities(): Capabilities {
  // Dual independent 32-byte CSPRNG tokens via getRandomValues.
  const wsCapability = randomHexBytes(32);
  let httpCapability = randomUrlSafeBytes(32);
  // token_urlsafe(32) yields 43 chars; pad deterministically if needed.
  while (httpCapability.length < 32) httpCapability += randomUrlSafeBytes(8);
  if (httpCapability === wsCapability) return generateCapabilities();
  return validateCapabilities({ httpCapability, wsCapability });
}

export function capabilityDirectory(): string {
  const override = (process.env.GODOT_CAPABILITY_DIR ?? "").trim();
  if (override) return resolve(override);
  return join(homedir(), ".config", "opencode", "godot", "capabilities");
}

export function recordPath(port: number, directory?: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("port must be 1-65535");
  }
  const dir = directory ? resolve(directory) : capabilityDirectory();
  return join(dir, `${port}.json`);
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function isStickyTempRoot(prefix: string, st: Stats): boolean {
  if (prefix !== "/tmp" && prefix !== "/var/tmp" && prefix !== "/private/tmp")
    return false;
  // Root-owned sticky directory (1777): safe shared temp root.
  return st.uid === 0 && st.isDirectory() && (Number(st.mode) & 0o1000) !== 0;
}

// Walk every existing ancestor of `target` (plus target itself when it
// exists). Reject symlinked components and group/other-writable dirs.
export function auditPosixPath(target: string): void {
  const abs = resolve(target);
  // Check each path prefix for symlink traversal.
  const parts = abs.split("/").filter(Boolean);
  let cur = "/";
  const prefixes: string[] = ["/"];
  for (const part of parts) {
    cur = cur === "/" ? `/${part}` : `${cur}/${part}`;
    prefixes.push(cur);
  }
  for (const prefix of prefixes) {
    let st: Stats | undefined;
    try {
      st = lstatSync(prefix) as Stats;
    } catch {
      continue;
    }
    if (!st) continue;
    if (st.isSymbolicLink()) {
      throw new Error(`capability path traverses symlink: ${prefix}`);
    }
    if (
      st.isDirectory() &&
      (st.mode & 0o022) !== 0 &&
      !isStickyTempRoot(prefix, st)
    ) {
      throw new Error(`capability ancestor is group/other-writable: ${prefix}`);
    }
  }
}

function ensurePrivateDir(dir: string): void {
  auditPosixPath(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  auditPosixPath(dir);
  const st = statSync(dir);
  if ((st.mode & 0o777) !== 0o700) {
    // Enforce private dir; tolerate umask quirks by explicit chmod above.
    throw new Error(`capability directory is not private: ${dir}`);
  }
}

export function writeCapabilities(
  port: number,
  caps: Capabilities,
  directory?: string,
): string {
  validateCapabilities(caps);
  const path = recordPath(port, directory);
  const dir = dirname(path);
  ensurePrivateDir(dir);
  auditPosixPath(path);
  if (isSymlink(path)) throw new Error(`capability path is a symlink: ${path}`);
  const payload = `${JSON.stringify({ http: caps.httpCapability, websocket: caps.wsCapability })}\n`;
  const tmp = join(dir, `.${port}.${process.pid}.${randomHexBytes(4)}.tmp`);
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, payload);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o600) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
    throw new Error("capability record failed post-write audit");
  }
  return path;
}

export function readCapabilities(
  port: number,
  directory?: string,
): Capabilities | null {
  let path: string;
  try {
    path = recordPath(port, directory);
  } catch {
    return null;
  }
  try {
    auditPosixPath(dirname(path));
    auditPosixPath(path);
    const lst = lstatSync(path);
    if (!lst.isFile() || lst.isSymbolicLink()) return null;
    if ((lst.mode & 0o077) !== 0) return null;
    if (lst.size > 4096) return null;
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw) as { http?: unknown; websocket?: unknown };
    if (typeof data.http !== "string" || typeof data.websocket !== "string")
      return null;
    // Directory must still be private at read time.
    const dirStat = statSync(dirname(path));
    if ((dirStat.mode & 0o077) !== 0) return null;
    return validateCapabilities({
      httpCapability: data.http,
      wsCapability: data.websocket,
    });
  } catch {
    return null;
  }
}
