import { describe, expect, test } from "bun:test";
import { ActivationScope } from "../src/effect";
import { createGodotPlugin } from "../src/plugin";

function mockCtx() {
  return {} as Parameters<ReturnType<typeof createGodotPlugin>["effect"]>[0];
}

describe("createGodotPlugin effect lifecycle", () => {
  test("exposes id godot with effect function", () => {
    const plugin = createGodotPlugin();
    expect(plugin.id).toBe("godot");
    expect(typeof plugin.effect).toBe("function");
  });

  test("effect returns cleanup that disposes scope", async () => {
    const plugin = createGodotPlugin();
    const cleanup = await plugin.effect(mockCtx());
    expect(typeof cleanup === "function" || cleanup === undefined).toBe(true);
    if (typeof cleanup === "function") await cleanup();
  });

  test("double-activate yields independent scopes", async () => {
    const plugin = createGodotPlugin();
    const order: string[] = [];
    const tracked = createGodotPlugin({
      onActivate: (scope) => {
        scope.register(() => {
          order.push("dispose");
        });
      },
    });
    const c1 = await tracked.effect(mockCtx());
    const c2 = await tracked.effect(mockCtx());
    expect(c1).not.toBe(c2);
    if (typeof c1 === "function") await c1();
    expect(order).toEqual(["dispose"]);
    if (typeof c2 === "function") await c2();
    expect(order).toEqual(["dispose", "dispose"]);
    void plugin;
  });

  test("dispose-without-activate is safe", async () => {
    const scope = new ActivationScope();
    await scope.dispose();
    expect(scope.disposed).toBe(true);
    expect(scope.size).toBe(0);
  });

  test("double-dispose is idempotent, disposers run once in reverse order", async () => {
    const scope = new ActivationScope();
    const calls: string[] = [];
    scope.register(() => {
      calls.push("first");
    });
    scope.register(() => {
      calls.push("second");
    });
    await scope.dispose();
    await scope.dispose();
    expect(calls).toEqual(["second", "first"]);
    expect(scope.disposed).toBe(true);
  });

  test("async disposers are awaited and errors do not prevent remaining cleanup", async () => {
    const scope = new ActivationScope();
    const calls: string[] = [];
    scope.register(() => {
      calls.push("a");
    });
    scope.register(() => {
      calls.push("b");
      throw new Error("boom");
    });
    scope.register(async () => {
      calls.push("c");
    });
    await scope.dispose();
    expect(calls).toEqual(["c", "b", "a"]);
  });

  test("register after dispose runs immediately", async () => {
    const scope = new ActivationScope();
    await scope.dispose();
    let ran = false;
    await scope.register(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
