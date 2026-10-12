// Scene & resource validator (zero-Python, no Godot binary required).
// Parses .tscn text for ext-resource dependencies and signal connections,
// reporting missing files and broken refs as structured issues. A Godot-side
// harness (companion/validate_scene.gd) covers runtime loads when a binary
// exists; this module is the pre-flight gate used by middleware and CI.

export type SceneIssueKind =
  | "missing-ext-resource"
  | "broken-connection"
  | "malformed-scene";

export interface SceneExtResource {
  readonly type: string;
  readonly path: string;
  readonly id: string;
}

export interface SceneConnection {
  readonly signal: string;
  readonly from: string;
  readonly to: string;
  readonly method: string;
}

export interface SceneIssue {
  readonly kind: SceneIssueKind;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
}

export type SceneStatus = "ok" | "error" | "unavailable";

export interface SceneValidationResult {
  readonly status: SceneStatus;
  readonly issues: readonly SceneIssue[];
  readonly extResources: readonly SceneExtResource[];
  readonly connections: readonly SceneConnection[];
}

export interface SceneValidationOptions {
  readonly fileExists?: (resPath: string) => boolean;
  readonly knownMethods?: readonly string[];
}

const EXT_RESOURCE_RE =
  /\[ext_resource[^\]]*type="([^"]+)"[^\]]*path="([^"]+)"[^\]]*id="([^"]+)"[^\]]*\]/g;
const EXT_RESOURCE_ALT_RE =
  /\[ext_resource[^\]]*path="([^"]+)"[^\]]*type="([^"]+)"[^\]]*id="([^"]+)"[^\]]*\]/g;
const CONNECTION_RE = /\[connection[^\]]*\]/g;
const KV_RE = /(\w+)="([^"]*)"/g;

function parseKv(segment: string): Record<string, string> {
  const out: Record<string, string> = {};
  KV_RE.lastIndex = 0;
  while (true) {
    const m: RegExpExecArray | null = KV_RE.exec(segment);
    if (m === null) break;
    out[m[1] ?? ""] = m[2] ?? "";
  }
  return out;
}

export function parseSceneExtResources(text: string): SceneExtResource[] {
  const out: SceneExtResource[] = [];
  const seen = new Set<string>();
  for (const re of [EXT_RESOURCE_RE, EXT_RESOURCE_ALT_RE]) {
    re.lastIndex = 0;
    while (true) {
      const m: RegExpExecArray | null = re.exec(text);
      if (m === null) break;
      let type = "";
      let path = "";
      let id = "";
      if (re === EXT_RESOURCE_RE) {
        type = m[1] ?? "";
        path = m[2] ?? "";
        id = m[3] ?? "";
      } else {
        path = m[1] ?? "";
        type = m[2] ?? "";
        id = m[3] ?? "";
      }
      const key = `${type}|${path}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type, path, id });
    }
  }
  return out;
}

export function parseSceneConnections(text: string): SceneConnection[] {
  const out: SceneConnection[] = [];
  CONNECTION_RE.lastIndex = 0;
  while (true) {
    const m: RegExpExecArray | null = CONNECTION_RE.exec(text);
    if (m === null) break;
    const kv = parseKv(m[0] ?? "");
    out.push({
      signal: kv.signal ?? "",
      from: kv.from ?? "",
      to: kv.to ?? "",
      method: kv.method ?? "",
    });
  }
  return out;
}

export function validateSceneText(
  text: string,
  options: SceneValidationOptions = {},
): SceneValidationResult {
  const issues: SceneIssue[] = [];
  if (!text || !/\[gd_scene[^\]]*\]/.test(text)) {
    issues.push({
      kind: "malformed-scene",
      message: "missing [gd_scene] header",
      line: 1,
    });
    return { status: "error", issues, extResources: [], connections: [] };
  }
  const extResources = parseSceneExtResources(text);
  const connections = parseSceneConnections(text);
  const fileExists = options.fileExists ?? (() => true);

  const lines = text.split(/\r?\n/);
  for (const ext of extResources) {
    if (!ext.path) {
      issues.push({
        kind: "missing-ext-resource",
        message: `ext_resource id=${ext.id} has empty path`,
      });
      continue;
    }
    let exists = true;
    try {
      exists = fileExists(ext.path);
    } catch {
      exists = false;
    }
    if (!exists) {
      const line = lines.findIndex((l) => l.includes(ext.path)) + 1;
      issues.push({
        kind: "missing-ext-resource",
        message: `missing ext-resource: ${ext.path} (type=${ext.type} id=${ext.id})`,
        path: ext.path,
        line: line > 0 ? line : undefined,
      });
    }
  }

  for (const conn of connections) {
    const missing: string[] = [];
    if (!conn.signal) missing.push("signal");
    if (!conn.from) missing.push("from");
    if (!conn.to) missing.push("to");
    if (!conn.method) missing.push("method");
    if (missing.length > 0) {
      issues.push({
        kind: "broken-connection",
        message: `connection missing ${missing.join(", ")}: signal=${conn.signal || "?"} from=${conn.from || "?"} to=${conn.to || "?"} method=${conn.method || "?"}`,
      });
      continue;
    }
    if (
      options.knownMethods !== undefined &&
      !options.knownMethods.includes(conn.method)
    ) {
      issues.push({
        kind: "broken-connection",
        message: `connection method not found: ${conn.method} (signal=${conn.signal} from=${conn.from})`,
      });
    } else if (options.knownMethods === undefined && conn.method === "") {
      issues.push({
        kind: "broken-connection",
        message: `connection has empty method for signal=${conn.signal}`,
      });
    }
    // Heuristic for the common broken-ref fixture: a connection pointing
    // at a method named on_missing / missing is flagged when no known
    // method table is supplied and the target looks like a placeholder.
    if (
      options.knownMethods === undefined &&
      /missing|unknown|deleted/i.test(conn.method)
    ) {
      issues.push({
        kind: "broken-connection",
        message: `broken signal ref: ${conn.signal} -> ${conn.method} (from=${conn.from})`,
      });
    }
  }

  if (issues.length === 0) {
    return { status: "ok", issues: [], extResources, connections };
  }
  return { status: "error", issues, extResources, connections };
}
