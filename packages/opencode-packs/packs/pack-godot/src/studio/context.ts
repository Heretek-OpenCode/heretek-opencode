// Studio context packing (zero @opencode/* imports).
// Structural `ctx.session.hook("context")`-compatible interceptor: pass
// `studioContextHook` as the hook callback. Injects engine version, editor
// status, and active scene tree into the model context exactly once
// (idempotent replace on repeat hooks).

export const GODOT_CONTEXT_MARKER = "<!-- godot-context -->";

export interface GodotContextSnapshot {
  readonly engineVersion: string;
  readonly editorStatus: string;
  readonly sceneTree: string;
}

export interface GodotContextProviders {
  readonly getEngineVersion?: () => Promise<string>;
  readonly getEditorStatus?: () => Promise<string>;
  readonly getSceneTree?: () => Promise<string>;
}

// Minimal structural session-context: real SessionContext subset (system
// array). Defined locally; no @opencode/* import.
export interface StudioSessionContext {
  agent?: string;
  system: unknown[];
}

export async function collectGodotContext(
  providers: GodotContextProviders = {},
): Promise<GodotContextSnapshot> {
  const engineVersion = providers.getEngineVersion
    ? await providers.getEngineVersion()
    : "unknown";
  const editorStatus = providers.getEditorStatus
    ? await providers.getEditorStatus()
    : "offline";
  const sceneTree = providers.getSceneTree
    ? await providers.getSceneTree()
    : "(no scene)";
  return { engineVersion, editorStatus, sceneTree };
}

export function buildContextInjection(snapshot: GodotContextSnapshot): string {
  return [
    GODOT_CONTEXT_MARKER,
    `Godot engine: ${snapshot.engineVersion}`,
    `Editor: ${snapshot.editorStatus}`,
    "Active scene tree:",
    snapshot.sceneTree,
  ].join("\n");
}

function isGodotInjection(entry: unknown): boolean {
  if (typeof entry === "string") return entry.includes(GODOT_CONTEXT_MARKER);
  if (entry && typeof entry === "object") {
    const text = (entry as { text?: unknown }).text;
    if (typeof text === "string") return text.includes(GODOT_CONTEXT_MARKER);
    try {
      return JSON.stringify(entry).includes(GODOT_CONTEXT_MARKER);
    } catch {
      return false;
    }
  }
  return false;
}

function toSystemEntry(text: string): unknown {
  return { type: "text", text };
}

export function applyContextInjection(
  target: StudioSessionContext,
  snapshot: GodotContextSnapshot,
): void {
  const text = buildContextInjection(snapshot);
  const entry = toSystemEntry(text);
  const idx = target.system.findIndex(isGodotInjection);
  if (idx >= 0) target.system[idx] = entry;
  else target.system.push(entry);
}

// `ctx.session.hook("context", (ctx) => studioContextHook(ctx, providers))`
// compatible: mutates `system` in place, idempotent.
export async function studioContextHook(
  target: StudioSessionContext,
  providers: GodotContextProviders = {},
): Promise<void> {
  const snapshot = await collectGodotContext(providers);
  applyContextInjection(target, snapshot);
}
