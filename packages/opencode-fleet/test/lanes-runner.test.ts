import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLaneArgv, executeInLane } from "../src/lanes/index.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "lane-qa-"));
}

describe("buildLaneArgv", () => {
  test("docker shape mounts the worktree and carries image+command", () => {
    const argv = buildLaneArgv({
      taskId: "t-1",
      tier: "docker",
      worktreeDir: "/tmp/wt",
      command: ["sh", "-c", "echo hi"],
      timeoutMs: 1000,
    });
    expect(argv.slice(0, 3)).toEqual(["docker", "run", "--rm"]);
    expect(argv).toContain("-v");
    expect(argv).toContain("/tmp/wt:/work");
    expect(argv).toContain("-w");
    expect(argv).toContain("/work");
    expect(argv).toContain("lane-base:latest");
    expect(argv.slice(-3)).toEqual(["sh", "-c", "echo hi"]);
  });

  test("bwrap shape binds the worktree and ends with the command", () => {
    const argv = buildLaneArgv({
      taskId: "t-1",
      tier: "bwrap",
      worktreeDir: "/tmp/wt",
      command: ["echo", "hello"],
      timeoutMs: 1000,
    });
    expect(argv[0]).toBe("bwrap");
    expect(argv).toContain("--ro-bind");
    expect(argv).toContain("/tmp/wt");
    expect(argv).toContain("--");
    expect(argv.slice(-2)).toEqual(["echo", "hello"]);
  });
});

describe("executeInLane (real child_process)", () => {
  test("runs `echo hello` with tier bwrap", async () => {
    const res = await executeInLane({
      taskId: "t-echo",
      tier: "bwrap",
      worktreeDir: tmp(),
      command: ["echo", "hello"],
      timeoutMs: 15_000,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("hello");
    expect(res.outputHash.startsWith("sha256:")).toBe(true);
    expect(res.timedOut).toBe(false);
  }, 20_000);

  test("timeout reports timedOut with exit 124", async () => {
    const res = await executeInLane({
      taskId: "t-sleep",
      tier: "bwrap",
      worktreeDir: tmp(),
      command: ["sleep", "5"],
      timeoutMs: 200,
    });
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBe(124);
  }, 20_000);
});
