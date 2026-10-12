import { describe, expect, test } from "bun:test";
import { SessionRegistry } from "../src/session/registry";

describe("SessionRegistry readiness", () => {
  test("registers sessions with readiness states", () => {
    const reg = new SessionRegistry();
    reg.register("proj@aaaabbbbccccdddd", "ready");
    expect(reg.get("proj@aaaabbbbccccdddd")).toBe("ready");
    reg.setState("proj@aaaabbbbccccdddd", "importing");
    expect(reg.get("proj@aaaabbbbccccdddd")).toBe("importing");
  });

  test("requireWritable allows ready, rejects importing with EDITOR_NOT_READY", () => {
    const reg = new SessionRegistry();
    reg.register("s1", "ready");
    expect(() => reg.requireWritable("s1")).not.toThrow();
    reg.setState("s1", "importing");
    try {
      reg.requireWritable("s1");
      expect(false).toBe(true);
    } catch (err) {
      expect((err as { code?: string }).code).toBe("EDITOR_NOT_READY");
    }
  });

  test("no_scene and test_running are not writable", () => {
    const reg = new SessionRegistry();
    reg.register("a", "no_scene");
    reg.register("b", "test_running");
    reg.register("c", "playing");
    expect(() => reg.requireWritable("a")).toThrow();
    expect(() => reg.requireWritable("b")).toThrow();
    expect(() => reg.requireWritable("c")).not.toThrow();
  });

  test("unknown session throws on requireWritable", () => {
    const reg = new SessionRegistry();
    expect(() => reg.requireWritable("missing")).toThrow();
  });

  test("waitForWritable resolves when reimport finishes within 8s budget", async () => {
    const reg = new SessionRegistry();
    reg.register("s", "importing");
    setTimeout(() => reg.setState("s", "ready"), 600);
    await reg.waitForWritable("s", { intervalMs: 100, timeoutMs: 2000 });
    expect(reg.get("s")).toBe("ready");
  });

  test("waitForWritable times out after max budget", async () => {
    const reg = new SessionRegistry();
    reg.register("s", "importing");
    let failed = false;
    try {
      await reg.waitForWritable("s", { intervalMs: 100, timeoutMs: 250 });
    } catch (err) {
      failed = true;
      expect((err as { code?: string }).code).toBe("EDITOR_NOT_READY");
    }
    expect(failed).toBe(true);
  });
});
