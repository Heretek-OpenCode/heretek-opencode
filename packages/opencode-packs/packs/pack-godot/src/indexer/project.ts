// Scene-graph project indexer (no Godot binary required).
// Parses the VariantParser-grammar subset of .tscn/.tres text
// ([gd_scene], [ext_resource], [node], [connection]) plus project.godot
// [autoload], then renders a Markdown architecture map. The filesystem
// is injected so tests run against an in-memory fixture.

export interface TscnExtResource {
  readonly type: string;
  readonly path: string;
  readonly id: string;
}

export interface TscnNode {
  readonly name: string;
  readonly type?: string;
  readonly parent?: string;
  readonly instanceOf?: string;
}

export interface TscnConnection {
  readonly signal: string;
  readonly from: string;
  readonly to: string;
  readonly method: string;
}

export interface ParsedTscn {
  readonly nodes: readonly TscnNode[];
  readonly extResources: readonly TscnExtResource[];
  readonly connections: readonly TscnConnection[];
}

export interface AutoloadEntry {
  readonly name: string;
  readonly path: string;
}

export interface IndexedScene {
  readonly path: string;
  readonly nodes: readonly TscnNode[];
  readonly extResources: readonly TscnExtResource[];
  readonly connections: readonly TscnConnection[];
  readonly scripts: readonly string[];
}

export interface SignalEdge {
  readonly scene: string;
  readonly signal: string;
  readonly from: string;
  readonly to: string;
  readonly method: string;
}

export interface ScriptEntry {
  readonly path: string;
  readonly usedBy: readonly string[];
}

export interface ProjectIndex {
  readonly scenes: readonly IndexedScene[];
  readonly autoloads: readonly AutoloadEntry[];
  readonly signalGraph: readonly SignalEdge[];
  readonly scripts: readonly ScriptEntry[];
}

export interface ProjectFileSystem {
  readonly listFiles: () => readonly string[] | Promise<readonly string[]>;
  readonly readFile: (path: string) => string | Promise<string>;
}

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

function parseBare(segment: string, key: string): string | undefined {
  const m = new RegExp(`${key}=([^\\s\\]]+)`).exec(segment);
  return m?.[1]?.replace(/^"|"$/g, "");
}

function instanceTarget(segment: string): string | undefined {
  const m = /instance=ExtResource\("([^"]+)"\)/.exec(segment);
  return m?.[1];
}

export function parseTscn(text: string): ParsedTscn {
  if (!/\[gd_scene[^\]]*\]/.test(text)) {
    throw new Error("parseTscn: missing [gd_scene] header");
  }
  const extResources: TscnExtResource[] = [];
  const nodes: TscnNode[] = [];
  const connections: TscnConnection[] = [];
  const sectionRe = /\[(ext_resource|node|connection)[^\]]*\]/g;
  sectionRe.lastIndex = 0;
  while (true) {
    const m: RegExpExecArray | null = sectionRe.exec(text);
    if (m === null) break;
    const kind = m[1];
    const seg = m[0] ?? "";
    const kv = parseKv(seg);
    if (kind === "ext_resource") {
      extResources.push({
        type: kv.type ?? "",
        path: kv.path ?? "",
        id: kv.id ?? "",
      });
    } else if (kind === "node") {
      nodes.push({
        name: kv.name ?? "Unnamed",
        ...(kv.type ? { type: kv.type } : {}),
        ...(kv.parent ? { parent: kv.parent } : {}),
        ...(instanceTarget(seg) ? { instanceOf: instanceTarget(seg) } : {}),
        ...(parseBare(seg, "instance") && !instanceTarget(seg)
          ? { instanceOf: parseBare(seg, "instance") }
          : {}),
      });
    } else {
      connections.push({
        signal: kv.signal ?? "",
        from: kv.from ?? "",
        to: kv.to ?? "",
        method: kv.method ?? "",
      });
    }
  }
  return { nodes, extResources, connections };
}

export function parseProjectGodot(text: string): AutoloadEntry[] {
  const out: AutoloadEntry[] = [];
  const lines = text.split(/\r?\n/);
  let inAutoload = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      inAutoload = line.toLowerCase() === "[autoload]";
      continue;
    }
    if (!inAutoload || !line || line.startsWith(";")) continue;
    const m = /^([A-Za-z_][\w]*)\s*=\s*"(\*?)([^"]+)"\s*$/.exec(line);
    if (m)
      out.push({ name: m[1] ?? "", path: (m[3] ?? "").replace(/^\*/, "") });
  }
  return out;
}

function isSceneFile(p: string): boolean {
  return p.endsWith(".tscn") || p.endsWith(".tres") || p.endsWith(".scn");
}

export async function indexProject(
  fs: ProjectFileSystem,
): Promise<ProjectIndex> {
  const files = await fs.listFiles();
  const projectFile = files.find((f) => f.endsWith("project.godot"));
  let autoloads: AutoloadEntry[] = [];
  if (projectFile) {
    try {
      autoloads = parseProjectGodot(await fs.readFile(projectFile));
    } catch {
      autoloads = [];
    }
  }
  const scenes: IndexedScene[] = [];
  for (const path of files.filter(isSceneFile)) {
    let text: string;
    try {
      text = await fs.readFile(path);
    } catch {
      continue;
    }
    let parsed: ParsedTscn;
    try {
      parsed = parseTscn(text);
    } catch {
      continue;
    }
    const idToPath = new Map(parsed.extResources.map((e) => [e.id, e.path]));
    const scripts = parsed.extResources
      .filter((e) => e.path.endsWith(".gd"))
      .map((e) => e.path);
    scenes.push({
      path,
      nodes: parsed.nodes.map((n) => {
        if (n.instanceOf && idToPath.has(n.instanceOf)) {
          return { ...n, instanceOf: idToPath.get(n.instanceOf) };
        }
        return n;
      }),
      extResources: parsed.extResources,
      connections: parsed.connections,
      scripts,
    });
  }
  const signalGraph: SignalEdge[] = scenes.flatMap((s) =>
    s.connections.map((c) => ({
      scene: s.path,
      signal: c.signal,
      from: c.from,
      to: c.to,
      method: c.method,
    })),
  );
  const byScript = new Map<string, Set<string>>();
  for (const s of scenes) {
    for (const e of s.extResources) {
      if (!e.path.endsWith(".gd")) continue;
      if (!byScript.has(e.path)) byScript.set(e.path, new Set());
      byScript.get(e.path)?.add(s.path);
    }
  }
  const scripts: ScriptEntry[] = [...byScript.entries()].map(([path, set]) => ({
    path,
    usedBy: [...set].sort(),
  }));
  return { scenes, autoloads, signalGraph, scripts };
}

function nodeLabel(n: TscnNode): string {
  const type = n.type ? ` (${n.type})` : "";
  const inst = n.instanceOf ? ` -> ${n.instanceOf}` : "";
  const parent = n.parent ? ` [parent: ${n.parent}]` : "";
  return `- ${n.name}${type}${inst}${parent}`;
}

export function renderArchitectureMap(index: ProjectIndex): string {
  const lines: string[] = ["# Architecture Map", ""];
  lines.push("## Autoloads", "");
  if (index.autoloads.length === 0) lines.push("_none_");
  for (const a of index.autoloads)
    lines.push(`- **${a.name}** — \`${a.path}\``);
  lines.push("", "## Scenes", "");
  if (index.scenes.length === 0) lines.push("_none_");
  for (const s of index.scenes) {
    lines.push(`### \`${s.path}\``, "");
    lines.push("#### Hierarchy", "");
    if (s.nodes.length === 0) lines.push("_no nodes_");
    for (const n of s.nodes) lines.push(nodeLabel(n));
    lines.push("", "#### Ext Resources", "");
    if (s.extResources.length === 0) lines.push("_none_");
    for (const e of s.extResources)
      lines.push(`- [${e.type}] \`${e.path}\` (id=${e.id})`);
    lines.push("");
  }
  lines.push("## Signal Graph", "");
  if (index.signalGraph.length === 0) lines.push("_no connections_");
  for (const g of index.signalGraph)
    lines.push(
      `- \`${g.scene}\`: \`${g.signal}\` \`${g.from}\` → \`${g.to}\` :: \`${g.method}\``,
    );
  lines.push("", "## Scripts", "");
  if (index.scripts.length === 0) lines.push("_none_");
  for (const s of index.scripts)
    lines.push(
      `- \`${s.path}\` — used by: ${s.usedBy.map((u) => `\`${u}\``).join(", ")}`,
    );
  lines.push("");
  return lines.join("\n");
}
