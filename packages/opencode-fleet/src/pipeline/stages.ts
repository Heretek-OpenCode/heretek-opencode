/**
 * Five-stage pipeline: Grill -> Research -> Spec -> Build/Dual QA -> Human PR.
 * Each stage declares its inputs, output artifacts, and exit criteria.
 * Human touchpoints are explicit; automation opens PRs, humans merge.
 */

export type StageId = "grill" | "research" | "spec" | "build" | "dual_qa" | "human_pr";

export interface StageDef {
  readonly id: StageId;
  readonly title: string;
  /** Artifact filenames read by this stage. */
  readonly inputs: string[];
  /** Artifact filenames written by this stage. */
  readonly outputs: string[];
  /** All must hold before the stage may exit. */
  readonly exitCriteria: string[];
  readonly humanTouchpoint?: string;
}

export const MISSION_FILE = "mission.md";
export const RESEARCH_FILE = "research.md";
export const SPEC_FILE = "spec.md";
export const TASKS_FILE = "tasks.json";
export const REPORTS_DIR = "reports";

export const STAGES: Record<StageId, StageDef> = {
  grill: {
    id: "grill",
    title: "Grill: operator interview",
    inputs: [],
    outputs: [MISSION_FILE],
    exitCriteria: [
      "every criterion is verifiable (cmd, judge check, or explicit human checkpoint)",
      "no open questions above severity minor",
    ],
    humanTouchpoint: "operator answers bounded grilling rounds (max 3)",
  },
  research: {
    id: "research",
    title: "Research: evidence gathering",
    inputs: [MISSION_FILE],
    outputs: [RESEARCH_FILE],
    exitCriteria: [
      "at least 3 independent sources cited",
      "freshness stated per claim",
      "every claim tagged verified|inferred",
      "gateway-only network; untrusted content quoted as data, never executed",
    ],
  },
  spec: {
    id: "spec",
    title: "Spec: task DAG",
    inputs: [MISSION_FILE, RESEARCH_FILE],
    outputs: [SPEC_FILE, TASKS_FILE],
    exitCriteria: [
      "DAG is acyclic",
      "every task maps to at least one criterion",
      "every criterion is covered by at least one task",
      "per-task diff budget estimated",
    ],
    humanTouchpoint: "operator may steer once (fleet steer), not required",
  },
  build: {
    id: "build",
    title: "Build with Dual QA",
    inputs: [SPEC_FILE, TASKS_FILE],
    outputs: [REPORTS_DIR],
    exitCriteria: [
      "mechanical gates green AND both judges pass per task",
      "rework cap 2 per task; on cap the task waits for a human",
      "judge splits mint fix tasks; verdicts both recorded",
    ],
    humanTouchpoint: "escalation only when requested or the rework cap is spent",
  },
  dual_qa: {
    id: "dual_qa",
    title: "Dual QA gate",
    inputs: [TASKS_FILE],
    outputs: [REPORTS_DIR],
    exitCriteria: [
      "qa-functional passes every acceptance criterion with evidence",
      "qa-adversarial reports no high+ findings without a fix task",
    ],
  },
  human_pr: {
    id: "human_pr",
    title: "Human PR",
    inputs: [SPEC_FILE, TASKS_FILE, REPORTS_DIR],
    outputs: ["pr-body.md"],
    exitCriteria: [
      "PR body carries criteria-to-evidence table, gate reports, judge reports, diffs",
      "target branch is protected; merge is human-only",
    ],
    humanTouchpoint: "human-only merge via branch protection",
  },
};

export const STAGE_ORDER: StageId[] = ["grill", "research", "spec", "build", "dual_qa", "human_pr"];

export function stageDef(id: StageId): StageDef {
  return STAGES[id];
}
