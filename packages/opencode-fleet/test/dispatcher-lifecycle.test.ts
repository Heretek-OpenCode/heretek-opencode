import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Dispatcher } from "../src/dispatcher/index.js";
import type { DispatcherConfig } from "../src/dispatcher/index.js";
import { Journal } from "../src/state/index.js";
import { makeTask } from "../src/state/index.js";
import type { Mission, Task } from "../src/state/index.js";

function git(dir: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fleet-dispatch-qa-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "qa@example.com");
  git(dir, "config", "user.name", "qa");
  writeFileSync(path.join(dir, "README.md"), "qa fixture\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "init");
  return dir;
}

function mission(): Mission {
  return { id: "m-qa", intent: "qa fixture mission", acceptance: [], state: "active" };
}

function cfg(repoRoot: string, gates: DispatcherConfig["gates"] = []): DispatcherConfig {
  return {
    repoRoot,
    missionDir: path.join(repoRoot, ".fleet-qa"),
    worktreeBase: path.join(repoRoot, "wt-qa"),
    gates,
    defaultTimeoutMs: 60_000,
  };
}

describe("Dispatcher lifecycle", () => {
  test("runAll completes two dependent tasks and cleans up worktrees", async () => {
    const repo = initRepo();
    const journal = new Journal();
    const d = new Dispatcher(cfg(repo));
    const tasks: Task[] = [
      makeTask({ id: "task-a", missionId: "m-qa" }),
      makeTask({ id: "task-b", missionId: "m-qa", deps: ["task-a"] }),
    ];
    const res = await d.runAll(mission(), tasks, journal);

    expect(res.tasks.filter((t) => t.state === "done").map((t) => t.id).sort()).toEqual(["task-a", "task-b"]);
    const events = journal.list().map((e) => e.event);
    expect(events).toContain("task.start");
    expect(events).toContain("task.transition");
    // Worktrees removed after dispatch.
    expect(existsSync(path.join(repo, "wt-qa", "task-a"))).toBe(false);
    expect(existsSync(path.join(repo, "wt-qa", "task-b"))).toBe(false);
  }, 120_000);

  test("persistent gate failure escalates to waiting_human after the rework cap", async () => {
    const repo = initRepo();
    const journal = new Journal();
    const d = new Dispatcher(cfg(repo, [{ id: "nope", kind: "custom", cmd: "false" }]));
    let tasks: Task[] = [makeTask({ id: "task-f", missionId: "m-qa" })];

    // Drive the rework path via repeated dispatchOne (MAX_REWORK=2 -> 3 outcomes).
    for (let i = 0; i < 3; i++) {
      const res = await d.dispatchOne("task-f", mission(), tasks, journal);
      tasks = res.tasks;
    }
    const task = tasks.find((t) => t.id === "task-f")!;
    expect(task.attempts).toBe(3);
    expect(task.state).toBe("waiting_human");
    expect(journal.list().map((e) => e.event)).toContain("task.waiting_human");
  }, 180_000);
});
