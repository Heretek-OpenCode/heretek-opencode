import { describe, expect, test } from "bun:test";
import { MAX_REWORK, applyOutcome, runToCompletion } from "../src/scheduler/index.js";
import type { TaskOutcome } from "../src/scheduler/index.js";
import { makeTask } from "../src/state/index.js";
import type { Task } from "../src/state/index.js";

const PASS: TaskOutcome = { gatesPass: true, functional: "pass", adversarial: "pass" };
const FAIL: TaskOutcome = { gatesPass: false, functional: "fail", adversarial: "fail" };
const SPLIT: TaskOutcome = { gatesPass: true, functional: "pass", adversarial: "fail" };

function one(id = "t-1"): Task[] {
  return [makeTask({ id, missionId: "m-1" })];
}

describe("applyOutcome", () => {
  test("pass marks done", () => {
    const r = applyOutcome(one(), "t-1", PASS);
    expect(r.tasks[0]!.state).toBe("done");
    expect(r.tasks[0]!.attempts).toBe(1);
    expect(r.createdFix).toBeUndefined();
  });

  test(`rework cap ${MAX_REWORK}: two failures requeue, third escalates`, () => {
    let tasks = one();
    let r = applyOutcome(tasks, "t-1", FAIL);
    expect(r.tasks.find((t) => t.id === "t-1")!.state).toBe("pending");
    tasks = r.tasks;
    r = applyOutcome(tasks, "t-1", FAIL);
    expect(r.tasks.find((t) => t.id === "t-1")!.state).toBe("pending");
    expect(r.tasks.find((t) => t.id === "t-1")!.attempts).toBe(2);
    tasks = r.tasks;
    r = applyOutcome(tasks, "t-1", FAIL);
    expect(r.tasks.find((t) => t.id === "t-1")!.state).toBe("waiting_human");
    expect(r.tasks.find((t) => t.id === "t-1")!.attempts).toBe(3);
  });

  test("judge disagreement mints a fix task depending on the original", () => {
    const r = applyOutcome(one(), "t-1", SPLIT);
    expect(r.createdFix).toBeDefined();
    expect(r.createdFix!.deps).toEqual(["t-1"]);
    expect(r.createdFix!.id).toMatch(/^t-1-fix-/);
    expect(r.createdFix!.stage).toBe("build");
    expect(r.tasks.find((t) => t.id === "t-1")!.state).toBe("pending");
  });

  test("disagreement after cap still escalates", () => {
    let tasks = [{ ...one()[0]!, attempts: MAX_REWORK }];
    const r = applyOutcome(tasks, "t-1", SPLIT);
    expect(r.tasks.find((t) => t.id === "t-1")!.state).toBe("waiting_human");
  });
});

describe("runToCompletion", () => {
  test("runs a chain to done", async () => {
    const tasks: Task[] = [
      makeTask({ id: "a", missionId: "m-1" }),
      makeTask({ id: "b", missionId: "m-1", deps: ["a"] }),
    ];
    const summary = await runToCompletion(tasks, async () => PASS);
    expect(summary.done).toBe(true);
    expect(summary.steps).toBe(2);
  });

  test("persistent failure ends in waiting_human", async () => {
    const summary = await runToCompletion(one(), async () => FAIL);
    expect(summary.done).toBe(false);
    expect(summary.waitingHuman).toEqual(["t-1"]);
    expect(summary.steps).toBe(MAX_REWORK + 1);
  });

  test("flaky task recovers within cap", async () => {
    let calls = 0;
    const summary = await runToCompletion(one(), async () => (++calls < 2 ? FAIL : PASS));
    expect(summary.done).toBe(true);
  });
});
