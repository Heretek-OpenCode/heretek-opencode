import { describe, expect, test } from "bun:test";
import { HeadlessRunner, parseHeadlessOutput } from "../src/verify/headless";

const SAMPLE_ERROR = `SCRIPT ERROR: Parse Error: Expected ":" after function name.
          at: GDScript::reload (res://scripts/player.gd:12:8)
ERROR: Failed to load script res://scripts/player.gd with error "Parse Error".
`;

describe("headless syntax checker", () => {
  test("parses syntax error location", () => {
    const diags = parseHeadlessOutput(SAMPLE_ERROR, "res://scripts/player.gd");
    expect(diags.length).toBeGreaterThan(0);
    const first = diags[0];
    expect(first).toBeDefined();
    expect(first?.file).toContain("player.gd");
    expect(first?.line).toBe(12);
    expect(first?.col).toBe(8);
    expect(first?.message.length).toBeGreaterThan(0);
  });

  test("missing binary degrades to unavailable instead of throwing", async () => {
    const runner = new HeadlessRunner({
      runFn: async () => {
        const err = new Error("spawn godot ENOENT") as Error & {
          code?: string;
        };
        err.code = "ENOENT";
        throw err;
      },
    });
    const result = await runner.checkScript("res://scripts/player.gd");
    expect(result.status).toBe("unavailable");
    expect(result.diagnostics).toEqual([]);
  });

  test("timeout is reported as timeout status", async () => {
    const runner = new HeadlessRunner({
      timeoutMs: 20,
      runFn: () =>
        new Promise<never>(() => {
          // never resolves: simulates a hung godot binary
        }),
    });
    const result = await runner.checkScript("res://scripts/player.gd");
    expect(result.status).toBe("timeout");
  });

  test("clean output reports ok", async () => {
    const runner = new HeadlessRunner({
      runFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    const result = await runner.checkScript("res://scripts/ok.gd");
    expect(result.status).toBe("ok");
  });

  test("nonzero exit with diagnostics reports error", async () => {
    const runner = new HeadlessRunner({
      runFn: async () => ({
        exitCode: 1,
        stdout: SAMPLE_ERROR,
        stderr: "",
      }),
    });
    const result = await runner.checkScript("res://scripts/player.gd");
    expect(result.status).toBe("error");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
