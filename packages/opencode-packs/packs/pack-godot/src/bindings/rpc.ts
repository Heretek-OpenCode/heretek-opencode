// Godot RPC namespace registration via a register-compatible shape.
// Minimal structural types only; malformed params fail closed.

export const GODOT_RPC_NAMESPACE = "godot";

const KNOWN_METHODS = [
  "editor_state",
  "scene_get_hierarchy",
  "node_get_properties",
  "session_activate",
] as const;

export type GodotRpcMethod = (typeof KNOWN_METHODS)[number];

export class RpcParamError extends Error {
  constructor(method: string, detail: string) {
    super(`invalid params for ${method}: ${detail}`);
    this.name = "RpcParamError";
  }
}

function assertParams(
  method: string,
  params: unknown,
): asserts params is Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new RpcParamError(method, "params must be an object");
  }
  const record = params as Record<string, unknown>;
  if ("session_id" in record && typeof record.session_id !== "string") {
    throw new RpcParamError(method, "session_id must be a string");
  }
}

export interface GodotRpcHandlers {
  invoke: (method: string, params: unknown) => Promise<unknown>;
}

// Register-compatible: rpc.register({ namespace, methods }, handlers).
export function createGodotRpcHandlers(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): GodotRpcHandlers {
  return {
    invoke: async (method: string, params: unknown) => {
      if (!(KNOWN_METHODS as readonly string[]).includes(method)) {
        throw new Error(`unknown godot rpc method: ${method}`);
      }
      assertParams(method, params);
      return send(method, params);
    },
  };
}

export function godotRpcDefinition(): {
  readonly namespace: typeof GODOT_RPC_NAMESPACE;
  readonly methods: readonly GodotRpcMethod[];
} {
  return { namespace: GODOT_RPC_NAMESPACE, methods: KNOWN_METHODS };
}
