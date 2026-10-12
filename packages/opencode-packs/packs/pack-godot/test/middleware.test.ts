import { describe, expect, test } from "bun:test";
import {
  SafetyMiddleware,
  isDestructiveCommand,
} from "../src/guards/middleware";

describe("safety middleware", () => {
  test("destructive commands are blocked", () => {
    expect(isDestructiveCommand("rm -rf /")).toBe(true);
    expect(isDestructiveCommand("rm -rf *")).toBe(true);
    expect(isDestructiveCommand("rm -rf ~")).toBe(true);
    expect(isDestructiveCommand("sudo rm -rf /tmp/x")).toBe(true);
    expect(isDestructiveCommand("git push --force")).toBe(true);
    expect(isDestructiveCommand("git push -f origin main")).toBe(true);
    expect(isDestructiveCommand("git reset --hard HEAD")).toBe(true);
  });

  test("safe commands are allowed", () => {
    expect(isDestructiveCommand("git status")).toBe(false);
    expect(isDestructiveCommand("git push origin main")).toBe(false);
    expect(isDestructiveCommand("ls -la")).toBe(false);
    expect(isDestructiveCommand("rm file.txt")).toBe(false);
  });

  test("middleware blocks destructive execute", async () => {
    const mw = new SafetyMiddleware();
    const blocked = await mw.beforeExecute({ command: "rm -rf /" });
    expect(blocked.allow).toBe(false);
    const ok = await mw.beforeExecute({ command: "git status" });
    expect(ok.allow).toBe(true);
  });

  test(".gd write is gated by syntax check", async () => {
    const mw = new SafetyMiddleware({
      checkGdscript: async (path) => {
        if (path.includes("bad")) {
          return {
            status: "error",
            diagnostics: [
              { file: path, line: 3, col: 1, message: "parse error" },
            ],
            raw: "error",
          };
        }
        return { status: "ok", diagnostics: [], raw: "" };
      },
    });
    const bad = await mw.beforeWrite({
      path: "res://bad.gd",
      content: "func broken(",
    });
    expect(bad.allow).toBe(false);
    const good = await mw.beforeWrite({
      path: "res://good.gd",
      content: "extends Node\n",
    });
    expect(good.allow).toBe(true);
  });

  test("non-script writes pass through", async () => {
    const mw = new SafetyMiddleware({
      checkGdscript: async () => {
        throw new Error("must not be called for .txt");
      },
    });
    const r = await mw.beforeWrite({ path: "notes.txt", content: "hi" });
    expect(r.allow).toBe(true);
  });
});
