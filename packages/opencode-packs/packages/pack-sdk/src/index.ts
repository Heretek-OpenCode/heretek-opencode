import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Pack manifest schema                                                */
/* ------------------------------------------------------------------ */

export const LaneRequireSchema = z.object({
  capability: z.string().min(1),
  image: z.string().min(1),
});

export const ToolRefSchema = z.object({
  server: z.string().min(1),
  transport: z.enum(["stdio", "http"]),
  /** Optional JSON-Schema-ish tool input schema; must survive a JSON round-trip. */
  schema: z.record(z.unknown()).optional(),
});

export const CommandRefSchema = z.object({
  name: z.string().min(1),
  handler: z.string().min(1),
});

/** Hook name -> handler module path. Values must be non-empty module refs. */
export const HooksSchema = z.record(z.string().min(1));

export const PackManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  hostCompat: z.string().min(1),
  laneRequires: z.array(LaneRequireSchema).optional(),
  tools: z.array(ToolRefSchema).optional(),
  skills: z.array(z.string().min(1)).optional(),
  commands: z.array(CommandRefSchema).optional(),
  hooks: HooksSchema.optional(),
  agents: z.array(z.string().min(1)).optional(),
  providers: z.array(z.string().min(1)).optional(),
});

export type PackManifestData = z.infer<typeof PackManifestSchema>;
export type LaneRequire = z.infer<typeof LaneRequireSchema>;
export type ToolRef = z.infer<typeof ToolRefSchema>;
export type CommandRef = z.infer<typeof CommandRefSchema>;

/* ------------------------------------------------------------------ */
/* ready() handshake                                                   */
/* ------------------------------------------------------------------ */

export interface ReadyResult {
  status: "ready" | "degraded";
  reason?: string;
}

export type ReadyFn = (hostVersion: string) => Promise<ReadyResult>;

export interface PackManifest extends PackManifestData {
  ready: ReadyFn;
}

/** Declare a pack. Validates the data half with Zod and requires a ready() handshake. */
export function definePack(manifest: PackManifest): PackManifest {
  const { ready, ...data } = manifest;
  PackManifestSchema.parse(data);
  if (typeof ready !== "function") {
    const id = (data as { id?: unknown }).id;
    throw new Error(
      `pack ${JSON.stringify(id)}: manifest must export a ready(hostVersion) handshake function`,
    );
  }
  return manifest;
}

/* ------------------------------------------------------------------ */
/* hostCompat range handling                                           */
/* ------------------------------------------------------------------ */

const EXACT_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const XRANGE_RE = /^\d+(\.\d+)?(\.[xX*]|\.x)?$/;
const CARET_RE = /^\^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const TILDE_RE = /^~\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** True when the hostCompat string is a supported range expression. */
export function isValidCompatRange(range: string): boolean {
  return (
    range === "*" ||
    EXACT_RE.test(range) ||
    XRANGE_RE.test(range) ||
    CARET_RE.test(range) ||
    TILDE_RE.test(range)
  );
}

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Evaluate hostVersion against a hostCompat range. Unknown shapes fail closed (false). */
export function hostSatisfiesCompat(hostCompat: string, hostVersion: string): boolean {
  const range = hostCompat.trim();
  const ver = parseVersion(hostVersion);
  if (!ver) return false;
  if (range === "*") return true;

  if (EXACT_RE.test(range)) {
    const base = parseVersion(range);
    return base !== null && cmp(ver, base) === 0;
  }
  if (XRANGE_RE.test(range)) {
    const parts = range.split(".");
    const major = Number(parts[0]);
    if (ver[0] !== major) return false;
    if (parts.length === 1) return true;
    if (parts[1] === "x" || parts[1] === "X" || parts[1] === "*") return true;
    if (ver[1] !== Number(parts[1])) return false;
    if (parts.length === 2) return true;
    const patch = parts[2];
    return patch === "x" || patch === "X" || patch === "*";
  }
  if (CARET_RE.test(range)) {
    const base = parseVersion(range.slice(1))!;
    return cmp(ver, base) >= 0 && ver[0] === base[0];
  }
  if (TILDE_RE.test(range)) {
    const base = parseVersion(range.slice(1))!;
    return cmp(ver, base) >= 0 && ver[0] === base[0] && ver[1] === base[1];
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Conformance                                                         */
/* ------------------------------------------------------------------ */

export interface ConformanceResult {
  pass: boolean;
  fail: string[];
}

function jsonRoundTrips(value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value);
  } catch {
    return false;
  }
}

/**
 * Run the pack contract checks:
 * manifest valid, hostCompat range well-formed, hook signatures present,
 * tool entries round-trip through JSON, readiness handshake is a function,
 * lane image refs present whenever laneRequires is declared.
 */
export function packConformance(manifest: unknown): ConformanceResult {
  const fail: string[] = [];
  if (typeof manifest !== "object" || manifest === null) {
    return { pass: false, fail: ["manifest must be an object"] };
  }
  const m = manifest as Record<string, unknown>;
  const { ready, ...data } = m;

  const parsed = PackManifestSchema.safeParse(data);
  if (!parsed.success) {
    fail.push(`manifest invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const id = typeof m.id === "string" && m.id.length > 0 ? m.id : "<unknown>";

  if (typeof ready !== "function") {
    fail.push(`pack "${id}": ready(hostVersion) handshake missing (must be a function)`);
  }

  if (typeof m.hostCompat !== "string" || !isValidCompatRange(m.hostCompat)) {
    fail.push(
      `pack "${id}": hostCompat ${JSON.stringify(m.hostCompat)} is not a supported semver range ` +
        `(exact "2.0.26", x-range "2.0.x", caret "^2.0.0", tilde "~2.0.0", or "*")`,
    );
  }

  if (m.hooks !== undefined) {
    if (typeof m.hooks !== "object" || m.hooks === null || Array.isArray(m.hooks)) {
      fail.push(`pack "${id}": hooks must be a { name: handlerPath } map`);
    } else {
      for (const [name, handler] of Object.entries(m.hooks as Record<string, unknown>)) {
        if (typeof handler !== "string" || handler.length === 0) {
          fail.push(`pack "${id}": hook "${name}" must map to a non-empty handler module path`);
        }
      }
    }
  }

  if (m.tools !== undefined && Array.isArray(m.tools)) {
    m.tools.forEach((t, i) => {
      if (!jsonRoundTrips(t)) {
        fail.push(`pack "${id}": tools[${i}] does not survive a JSON schema round-trip`);
      }
    });
  }

  if (m.laneRequires !== undefined && Array.isArray(m.laneRequires)) {
    m.laneRequires.forEach((l, i) => {
      const lane = l as { capability?: unknown; image?: unknown };
      if (typeof lane.image !== "string" || lane.image.length === 0) {
        fail.push(
          `pack "${id}": laneRequires[${i}] declares capability ` +
            `${JSON.stringify(lane.capability)} without a lane image ref`,
        );
      }
    });
  }

  return { pass: fail.length === 0, fail };
}
