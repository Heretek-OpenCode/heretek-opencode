// Re-export of the ported Godot plugin API (see ./plugin.ts, ./effect.ts).
// NOTE: GODOT_BRIDGE_PORT / GODOT_BRIDGE_HOST are intentionally NOT
// re-exported here — the pack manifest (./index.ts) already defines
// identical values, and re-exporting would collide.
export { ActivationScope } from "./effect";
export type { Disposer } from "./effect";
export { createGodotPlugin } from "./plugin";
export type {
  CreateGodotPluginOptions,
  GodotPlugin,
  GodotPluginContext,
  PluginCleanup,
} from "./plugin";
