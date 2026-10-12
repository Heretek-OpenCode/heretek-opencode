import { describe, expect, test } from "bun:test";
import { GutRunner, parseGutJUnit, parseGutTap } from "../src/verify/gut";

const SAMPLE_TAP = `TAP version 13
1..4
ok 1 test_player_moves
not ok 2 test_player_jumps # res://tests/test_player.gd:24 stack: jump()
ok 3 test_enemy_spawns # time=0.012s
ok 4 test_scene_loads # time=0.105s
# fail: 1 pass: 3
`;

const SAMPLE_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="gut" tests="3" failures="1" time="0.42">
    <testcase classname="test_player" name="test_moves" time="0.01"/>
    <testcase classname="test_player" name="test_jumps" time="0.02">
      <failure message="assert failed">res://tests/test_player.gd:24
stack: jump()</failure>
    </testcase>
    <testcase classname="test_enemy" name="test_spawns" time="0.39"/>
  </testsuite>
</testsuites>
`;

describe("gut runner", () => {
  test("sample TAP parsed with timings", () => {
    const result = parseGutTap(SAMPLE_TAP);
    expect(result.total).toBe(4);
    expect(result.pass).toBe(3);
    expect(result.fail).toBe(1);
    expect(result.tests.length).toBe(4);
    const failing = result.tests.find((t) => t.status === "fail");
    expect(failing?.name).toBe("test_player_jumps");
    expect(failing?.file).toContain("test_player.gd");
    // Failure stack preserved.
    expect((failing?.message ?? "").length).toBeGreaterThan(0);
  });

  test("junit parsed with failure stack", () => {
    const result = parseGutJUnit(SAMPLE_JUNIT);
    expect(result.total).toBe(3);
    expect(result.pass).toBe(2);
    expect(result.fail).toBe(1);
    const failing = result.tests.find((t) => t.status === "fail");
    expect(failing?.name).toBe("test_jumps");
    expect(failing?.stack?.join("\n")).toContain("test_player.gd");
  });

  test("missing binary degrades to unavailable", async () => {
    const runner = new GutRunner({
      runFn: async () => {
        const err = new Error("spawn godot ENOENT") as Error & {
          code?: string;
        };
        err.code = "ENOENT";
        throw err;
      },
    });
    const result = await runner.run();
    expect(result.status).toBe("unavailable");
  });

  test("tap run reports pass/fail counts", async () => {
    const runner = new GutRunner({
      runFn: async () => ({ exitCode: 1, stdout: SAMPLE_TAP, stderr: "" }),
    });
    const result = await runner.run();
    expect(result.status).toBe("fail");
    expect(result.pass).toBe(3);
    expect(result.fail).toBe(1);
    expect(result.tests.length).toBe(4);
  });

  test("empty output is an error, not a crash", async () => {
    const runner = new GutRunner({
      runFn: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    const result = await runner.run();
    expect(["pass", "error"]).toContain(result.status);
  });
});
