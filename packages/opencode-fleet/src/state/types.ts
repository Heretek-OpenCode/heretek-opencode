// Mission/Task/Criterion domain types. The schemas live in @heretek-ai/sdk
// (packages/opencode-sdk/src/contracts.ts) — this module re-exports the
// inferred types and adds fleet-local helpers. No schema is duplicated here.
export type {
  Mission,
  Task,
  Criterion,
  GateReport,
  MCPToolDef,
} from "../../../opencode-sdk/src/contracts.js";
export {
  MissionSchema,
  TaskSchema,
  CriterionSchema,
  GateReportSchema,
  MCPToolDefSchema,
} from "../../../opencode-sdk/src/contracts.js";

import type { Task } from "../../../opencode-sdk/src/contracts.js";

export type TaskState = Task["state"];
export type TaskStage = Task["stage"];
export type MissionState = import("../../../opencode-sdk/src/contracts.js").Mission["state"];

/** Terminal states: the scheduler never dispatches these. */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set(["done", "failed", "cancelled"]);

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Branch conventions shared with the pipeline and lanes. */
export const taskBranch = (taskId: string): string => `fleet/${taskId}`;
export const integrationBranch = (missionId: string): string => `fleet/integration/${missionId}`;
export const salvageRef = (taskId: string): string => `refs/fleet-salvage/${taskId}`;

/** Build a fresh task with fleet defaults (branch + zero attempts). */
export function makeTask(init: {
  id: string;
  missionId: string;
  stage?: TaskStage;
  deps?: string[];
  lane?: Task["lane"];
  budget?: Task["budget"];
  state?: TaskState;
}): Task {
  return {
    id: init.id,
    missionId: init.missionId,
    stage: init.stage ?? "build",
    state: init.state ?? "pending",
    deps: init.deps ?? [],
    lane: init.lane ?? "bwrap",
    branch: taskBranch(init.id),
    attempts: 0,
    budget: init.budget ?? { maxDiffLines: 800, maxDurationMinutes: 30 },
  };
}
