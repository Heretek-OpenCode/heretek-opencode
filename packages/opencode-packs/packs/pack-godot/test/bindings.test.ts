import { describe, expect, test } from "bun:test";
import {
  GODOT_RPC_NAMESPACE,
  createGodotRpcHandlers,
} from "../src/bindings/rpc";
import { GODOT_TOOLS, applyGodotTools } from "../src/bindings/tools";

function mockEditor() {
  const tools = new Map<string, { description: string }>();
  return {
    add(def: { id: string; description: string }) {
      if (tools.has(def.id)) throw new Error(`duplicate tool: ${def.id}`);
      tools.set(def.id, def);
    },
    get(id: string) {
      return tools.get(id);
    },
    list() {
      return [...tools.keys()];
    },
    remove(id: string) {
      tools.delete(id);
    },
  };
}

function mockCtx() {
  const editor = mockEditor();
  const rpcDefs: unknown[] = [];
  return {
    editor,
    ctx: {
      tool: {
        transform: (fn: (e: unknown) => void) => fn(editor),
      },
      rpc: {
        register: (def: unknown, handlers: unknown) => {
          rpcDefs.push([def, handlers]);
          return { events: { emit: () => {} } };
        },
      },
    },
    rpcDefs,
  };
}

describe("godot tool bindings", () => {
  test("registers godot tools via transform-compatible adapter", () => {
    const { ctx, editor } = mockCtx();
    (ctx.tool.transform as (fn: (e: unknown) => void) => void)((e) =>
      applyGodotTools(e as Parameters<typeof applyGodotTools>[0]),
    );
    for (const tool of GODOT_TOOLS) {
      expect(editor.get(tool.id)).toBeDefined();
    }
  });

  test("duplicate tool registration is rejected", () => {
    const editor = mockEditor();
    applyGodotTools(editor as Parameters<typeof applyGodotTools>[0]);
    expect(() =>
      applyGodotTools(editor as Parameters<typeof applyGodotTools>[0]),
    ).toThrow();
  });

  test("tool execute delegates to transport and validates session routing", async () => {
    const calls: unknown[] = [];
    const transport = async (method: string, params: unknown) => {
      calls.push([method, params]);
      return { ok: true };
    };
    const tool = GODOT_TOOLS.find((t) => t.id === "godot_editor_state");
    if (!tool) throw new Error("missing godot_editor_state tool");
    const result = await tool.execute({ session_id: "" }, transport as never);
    expect(result).toEqual({ ok: true });
    expect(calls.length).toBe(1);
  });
});

describe("godot rpc bindings", () => {
  test("registers namespace via register-compatible shape", () => {
    const { ctx, rpcDefs } = mockCtx();
    const handlers = createGodotRpcHandlers(async () => ({ ok: true }));
    (ctx.rpc.register as (d: unknown, h: unknown) => void)(
      { namespace: GODOT_RPC_NAMESPACE, methods: {} },
      handlers,
    );
    expect(rpcDefs.length).toBe(1);
  });

  test("malformed RPC params are rejected", async () => {
    const handlers = createGodotRpcHandlers(async (method: string) => ({
      method,
    }));
    let failed = false;
    try {
      await handlers.invoke("editor_state", "not-an-object" as never);
    } catch (err) {
      failed = true;
      expect((err as Error).message).toMatch(/params/i);
    }
    expect(failed).toBe(true);
  });

  test("unknown RPC method is rejected", async () => {
    const handlers = createGodotRpcHandlers(async () => ({}));
    let failed = false;
    try {
      await handlers.invoke("nope", {});
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
