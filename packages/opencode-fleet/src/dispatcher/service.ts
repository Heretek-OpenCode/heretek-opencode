import type { Mission, Task } from "../state/types.js";
import type { Journal } from "../state/journal.js";
import { readySet, validateDag } from "../dag/graph.js";
import { applyOutcome } from "../scheduler/runner.js";
import { selectTier } from "../lanes/tiers.js";
import { executeInLane, type LaneExecutionResult } from "../lanes/runner.js";
import { createWorktree, destroyWorktree, type WorktreeInfo } from "../lanes/worktree.js";
import { runGates, type GateDef } from "../gates/runner.js";

export interface DispatcherConfig {
  repoRoot: string;
  missionDir: string;
  worktreeBase: string;
  gates?: GateDef[];
  judgeProvider?: JudgeProvider;
  laneImage?: string;
  defaultTimeoutMs?: number;
  actor?: string;
}

export interface JudgeProvider {
  judge(seat: "qa-functional" | "qa-adversarial", task: Task, workdir: string): Promise<"pass" | "fail">;
}

export interface DispatchSummary {
  taskId: string;
  finalState: Task["state"];
  attempts: number;
  lane: LaneExecutionResult | null;
  gatesPass: boolean;
  functional: "pass" | "fail";
  adversarial: "pass" | "fail";
  journalEvents: number;
}

export interface DispatchOneResult {
  mission: Mission;
  tasks: Task[];
  summary: DispatchSummary;
}

export class Dispatcher {
  private readonly cfg: DispatcherConfig;

  constructor(cfg: DispatcherConfig) {
    this.cfg = cfg;
  }

  async dispatchOne(taskId: string, mission: Mission, tasks: Task[], journal: Journal): Promise<DispatchOneResult> {
    return dispatchTask(this.cfg, taskId, mission, tasks, journal);
  }

  async runAll(
    mission: Mission,
    tasks: Task[],
    journal: Journal,
  ): Promise<{ mission: Mission; tasks: Task[]; summaries: DispatchSummary[] }> {
    validateDag(tasks);
    let current = tasks.map((t) => ({ ...t }));
    const summaries: DispatchSummary[] = [];
    for (let i = 0; i < 10_000; i++) {
      const ready = readySet(current);
      if (ready.length === 0) break;
      const next = ready[0]!;
      const res = await this.dispatchOne(next.id, mission, current, journal);
      current = res.tasks;
      summaries.push(res.summary);
      // applyOutcome may mint fix tasks; keep looping over the updated list.
      void this.cfg.missionDir;
    }
    return { mission, tasks: current, summaries };
  }
}

export async function dispatchTask(
  cfg: DispatcherConfig,
  taskId: string,
  mission: Mission,
  tasks: Task[],
  journal: Journal,
): Promise<DispatchOneResult> {
  const actor = cfg.actor ?? "dispatcher";
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown task ${JSON.stringify(taskId)}`);
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  for (const dep of task.deps) {
    const d = byId.get(dep);
    if (!d || d.state !== "done") throw new Error(`task ${JSON.stringify(taskId)} blocked: dep ${JSON.stringify(dep)} not done`);
  }

  const before = journal.length;
  journal.append("task.start", { taskId }, actor);
  const info: WorktreeInfo = await createWorktree(cfg.repoRoot, taskId, cfg.worktreeBase);
  let lane: LaneExecutionResult | null = null;
  try {
    const selection = task.lane
      ? selectTier({ force: task.lane })
      : selectTier({ needsCleanEnv: true });
    const taskCommand = (task as unknown as { cmd?: unknown }).cmd;
    const shellCmd = typeof taskCommand === "string" && taskCommand.length > 0 ? taskCommand : "true";
    lane = await executeInLane({
      taskId,
      tier: selection.tier,
      image: cfg.laneImage ?? selection.image,
      worktreeDir: info.dir,
      command: ["sh", "-c", shellCmd],
      timeoutMs: cfg.defaultTimeoutMs ?? 300_000,
    });
    const lanePass = lane.exitCode === 0 && !lane.timedOut;

    const checks = await runGates(cfg.gates ?? [], info.dir);
    const gatesPass = lanePass && checks.every((c) => c.exit === 0);

    // Default judge behavior is mechanical: derive verdicts from gate
    // results. A real model-backed JudgeProvider can be injected via config.
    let functional: "pass" | "fail";
    let adversarial: "pass" | "fail";
    if (cfg.judgeProvider) {
      functional = await cfg.judgeProvider.judge("qa-functional", task, info.dir);
      adversarial = await cfg.judgeProvider.judge("qa-adversarial", task, info.dir);
    } else {
      functional = gatesPass ? "pass" : "fail";
      adversarial = gatesPass ? "pass" : "fail";
    }

    const applied = applyOutcome(tasks, taskId, { gatesPass, functional, adversarial });
    const updated = tasks.find((t) => t.id === taskId);
    journal.append("task.transition", { taskId, transition: applied.transition }, actor);
    const next = applied.tasks.find((t) => t.id === taskId)!;
    if (next.state === "waiting_human") {
      journal.append("task.waiting_human", { taskId, attempts: next.attempts }, actor);
    }
    void updated;
    return {
      mission,
      tasks: applied.tasks,
      summary: {
        taskId,
        finalState: next.state,
        attempts: next.attempts,
        lane,
        gatesPass,
        functional,
        adversarial,
        journalEvents: journal.length - before,
      },
    };
  } finally {
    await destroyWorktree(cfg.repoRoot, info, { salvage: true }).catch(() => undefined);
  }
}
