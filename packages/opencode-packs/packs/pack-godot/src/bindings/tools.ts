// Godot tool bindings via a transform-compatible adapter shape.
// Defines minimal structural editor interfaces locally (no opencode
// imports) so tests inject a mock ctx/editor.

export interface MinimalToolEditor {
  add(def: { readonly id: string; readonly description: string }): void;
  get(id: string): unknown;
  list(): readonly string[];
  remove(id: string): void;
}

export type BridgeSend = (method: string, params: unknown) => Promise<unknown>;

export interface GodotToolDefinition {
  readonly id: string;
  readonly description: string;
  execute: (params: unknown, send: BridgeSend) => Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withSessionScope(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) throw new Error("tool params must be an object");
  return params;
}

function makeTool(
  id: string,
  description: string,
  method: string,
): GodotToolDefinition {
  return {
    id,
    description,
    execute: async (params: unknown, send: BridgeSend) => {
      const scoped = withSessionScope(params);
      return send(method, scoped);
    },
  };
}

export const GODOT_TOOLS: readonly GodotToolDefinition[] = [
  makeTool(
    "godot_editor_state",
    "Read Godot editor state (Resource form: godot://editor/state)",
    "editor_state",
  ),
  makeTool(
    "godot_scene_get_hierarchy",
    "Read scene hierarchy (Resource form: godot://scene/hierarchy)",
    "scene_get_hierarchy",
  ),
  makeTool(
    "godot_node_get_properties",
    "Read node properties (Resource form: godot://node/{path}/properties)",
    "node_get_properties",
  ),
  makeTool(
    "godot_session_activate",
    "Activate a Godot session by id",
    "session_activate",
  ),
  makeTool(
    "godot_capture_viewport",
    "Capture viewport screenshot as base64 PNG (Resource form: godot://viewport/capture; stale fallback past 1000ms)",
    "capture_viewport",
  ),
  makeTool(
    "godot_shader_generate",
    "Generate spatial/canvas-item shader with uniforms",
    "generate_shader",
  ),
  makeTool(
    "godot_theme_apply_style",
    "Inspect Theme/StyleBox overrides and apply style (font/color/StyleBoxFlat)",
    "apply_stylebox",
  ),
];

// Transform-compatible: pass directly to ctx.tool.transform(editor => ...).
export function applyGodotTools(editor: MinimalToolEditor): void {
  for (const tool of GODOT_TOOLS) {
    if (editor.get(tool.id) !== undefined) {
      throw new Error(`duplicate tool registration: ${tool.id}`);
    }
    editor.add({ id: tool.id, description: tool.description });
  }
}
