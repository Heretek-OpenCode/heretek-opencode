// Godot plugin entry: OpenCode v2 Effect-compatible shape.
// Defines minimal structural context/cleanup types locally so the plugin
// does not import opencode packages (avoids coupling; tests use a mock ctx).

import { ActivationScope } from "./effect";

export type PluginCleanup = () => Promise<void> | void;

// Minimal structural context: real OpenCode ctx carries tool/rpc/etc.
// domains; the core lifecycle does not require any of them.
export interface GodotPluginContext {
  readonly [key: string]: unknown;
}

export interface GodotPlugin {
  readonly id: "godot";
  readonly effect: (
    ctx: GodotPluginContext,
    // biome-ignore lint/suspicious/noConfusingVoidType: OpenCode v2 effect shape allows void cleanup.
  ) => Promise<PluginCleanup | void> | PluginCleanup | void;
}

export interface CreateGodotPluginOptions {
  readonly onActivate?: (
    scope: ActivationScope,
    ctx: GodotPluginContext,
  ) => void;
  readonly onDispose?: () => Promise<void> | void;
}

export function createGodotPlugin(
  options: CreateGodotPluginOptions = {},
): GodotPlugin {
  return {
    id: "godot",
    effect: (ctx: GodotPluginContext) => {
      const scope = new ActivationScope();
      if (options.onActivate) options.onActivate(scope, ctx);
      if (options.onDispose) scope.register(options.onDispose);
      let cleaned = false;
      const cleanup: PluginCleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        await scope.dispose();
      };
      // Attach scope for introspection without expanding the public shape.
      (cleanup as { scope?: ActivationScope }).scope = scope;
      return cleanup;
    },
  };
}
