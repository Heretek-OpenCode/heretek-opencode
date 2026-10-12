import type { Task } from "../state/types.js";
import { makeTask } from "../state/types.js";
import { allDone, readySet, settled, validateDag } from "../dag/graph.js";

/**
 * Scheduler: dispatch ready tasks, bound rework, escalate to humans.
 *
 * Contract:
 *  - A failed task (gates or either judge) is requeued while
 *    `attempts <= MAX_REWORK + 1` worth of executions remain; after the
 *    rework budget is spent the task moves to `waiting_human`.
 *  - Judge disagreement (one judge passes, the other fails) always mints a
 *    dedicated fix task that depends on the original — judges never
 *    negotiate; the ledger records both verdicts.
 *  - Escalation is terminal for the loop: `waiting_human` needs an operator.
 */

/** Retries allowed after the first execution (executions total = 1 + cap). */
export const MAX_REWORK = 2;

export type JudgeVerdict = "pass" | "fail";

export interface TaskOutcome {
  readonly gatesPass: boolean;
  readonly functional: JudgeVerdict;
  readonly adversarial: JudgeVerdict;
  /** Optional note recorded with the transition (evidence hash, summary). */
  readonly note?: string;
}

export interface ApplyResult {
  readonly tasks: Task[];
  /** Minted when judges disagree (or on any failure needing a follow-up). */
  readonly createdFix?: Task;
  readonly transition: string;
}

export function judgesDisagreeOutcome(o: TaskOutcome): boolean {
  return o.gatesPass && o.functional !== o.adversarial;
}

export function outcomePass(o: TaskOutcome): boolean {
  return o.gatesPass && o.functional === "pass" && o.adversarial === "pass";
}

/** Mint a fix task for a failed/disputed task. Depends on the original. */
export function planFixTask(failed: Task, reason: string): Task {
  const fix = makeTask({
    id: `${failed.id}-fix-${failed.attempts + 1}`,
    missionId: failed.missionId,
    stage: "build",
    deps: [failed.id],
    lane: failed.lane,
    budget: failed.budget,
  });
  return { ...fix, branch: `fleet/${fix.id}` , attempts: 0 };
}

function withTask(tasks: Task[], id: string, patch: Partial<Task>): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/**
 * Apply one task outcome. Pure: returns the next task list plus any
 * minted fix task. Attempts increment on every application.
 */
export function applyOutcome(tasks: Task[], taskId: string, outcome: TaskOutcome): ApplyResult {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown task ${JSON.stringify(taskId)}`);
  const attempts = task.attempts + 1;

  if (outcomePass(outcome)) {
    return {
      tasks: withTask(tasks, taskId, { state: "done", attempts }),
      transition: `${taskId}: running -> done (attempt ${attempts})`,
    };
  }

  const exhausted = attempts > MAX_REWORK;
  if (exhausted) {
    return {
      tasks: withTask(tasks, taskId, { state: "waiting_human", attempts }),
      transition: `${taskId}: running -> waiting_human (rework cap ${MAX_REWORK} spent)`,
    };
  }

  if (judgesDisagreeOutcome(outcome)) {
    const fix = planFixTask({ ...task, attempts }, `judge split functional=${outcome.functional} adversarial=${outcome.adversarial}`);
    return {
      tasks: [...withTask(tasks, taskId, { state: "pending", attempts }), fix],
      createdFix: fix,
      transition: `${taskId}: running -> pending (judge split; fix ${fix.id} minted)`,
    };
  }

  const fix = planFixTask(
    { ...task, attempts },
    `failure gatesPass=${outcome.gatesPass} functional=${outcome.functional} adversarial=${outcome.adversarial}`,
  );
  return {
    tasks: [...withTask(tasks, taskId, { state: "pending", attempts }), fix],
    createdFix: fix,
    transition: `${taskId}: running -> pending (attempt ${attempts}/${MAX_REWORK + 1}; fix ${fix.id} minted)`,
  };
}

export interface RunOptions {
  /** Max loop iterations (safety bound). */
  readonly maxSteps?: number;
  readonly onTransition?: (line: string) => void;
}

export interface RunSummary {
  readonly tasks: Task[];
  readonly done: boolean;
  readonly waitingHuman: string[];
  readonly failed: string[];
  readonly steps: number;
}

/**
 * Run the DAG to settlement. `execute` runs one task (gates + judges) and
 * returns its outcome; the scheduler owns state transitions only.
 */
export async function runToCompletion(
  initial: Task[],
  execute: (task: Task) => Promise<TaskOutcome>,
  opts: RunOptions = {},
): Promise<RunSummary> {
  validateDag(initial);
  let tasks = initial.map((t) => ({ ...t }));
  const maxSteps = opts.maxSteps ?? 10_000;
  let steps = 0;
  const say = opts.onTransition ?? ((): void => {});

  while (steps < maxSteps) {
    if (allDone(tasks)) return summarize(tasks, steps);
    if (settled(tasks)) return summarize(tasks, steps);
    const ready = readySet(tasks);
    if (ready.length === 0) {
      // Nothing dispatchable but work remains: blocked on waiting_human/failed.
      return summarize(tasks, steps);
    }
    const task = ready[0]!;
    tasks = withTask(tasks, task.id, { state: "running" });
    say(`${task.id}: ready -> running (attempt ${task.attempts + 1})`);
    const outcome = await execute({ ...task, state: "running" });
    const applied = applyOutcome(tasks, task.id, outcome);
    tasks = applied.tasks;
    say(applied.transition);
    if (applied.createdFix) say(`minted fix task ${applied.createdFix.id}`);
    steps++;
  }
  return summarize(tasks, steps);
}

function summarize(tasks: Task[], steps: number): RunSummary {
  return {
    tasks,
    done: allDone(tasks),
    waitingHuman: tasks.filter((t) => t.state === "waiting_human").map((t) => t.id),
    failed: tasks.filter((t) => t.state === "failed").map((t) => t.id),
    steps,
  };
}
