/**
 * @heretek-ai/fleet — lean build factory and fleet engine.
 *
 * Trust model: git commit SHAs + sha256 journal hash chains + GitHub branch
 * protection + human-only merges. No key ceremonies, no envelopes.
 */
export * as state from "./state/index.js";
export * as dag from "./dag/index.js";
export * as scheduler from "./scheduler/index.js";
export * as lanes from "./lanes/index.js";
export * as host from "./host/index.js";
export * as gates from "./gates/index.js";
export * as judges from "./judges/index.js";
export * as pipeline from "./pipeline/index.js";
export * as cli from "./cli/index.js";
export * as util from "./util/index.js";

// Flat re-exports of the most-used symbols.
export { Journal, saveSnapshot, resumeMission, appendJournalEvent, loadJournal, verifyJournalFile } from "./state/index.js";
export { validateDag, topoSort, readySet, findCycle } from "./dag/index.js";
export { runToCompletion, applyOutcome, planFixTask, goalUnchanged, checkGoalDrift, MAX_REWORK } from "./scheduler/index.js";
export { selectTier, createWorktree, destroyWorktree, salvageBranch } from "./lanes/index.js";
export { HostAdapter } from "./host/index.js";
export { runGates, buildGateReport, checkBudget, DEFAULT_GATES } from "./gates/index.js";
export { parseJudgeReport, judgesDisagree, renderFunctionalPrompt, renderAdversarialPrompt } from "./judges/index.js";
export { STAGES, STAGE_ORDER } from "./pipeline/index.js";
