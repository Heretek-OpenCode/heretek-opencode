// Domain types live in the SDK; re-exported here for convenience (never duplicated).
export type { Mission, Task, Criterion, GateReport, MCPToolDef } from "./types.js";
export {
  TERMINAL_STATES,
  isTerminal,
  taskBranch,
  integrationBranch,
  salvageRef,
  makeTask,
} from "./types.js";
export type { TaskState, TaskStage, MissionState } from "./types.js";
export {
  Journal,
  entryHash,
  parseJournalLine,
  verifyEntries,
  journalPath,
  snapshotPath,
  saveJournal,
  appendJournalEvent,
  loadJournal,
  verifyJournalFile,
  saveSnapshot,
  resumeMission,
} from "./journal.js";
export type { JournalEntry, VerifyResult, Snapshot, ResumeState } from "./journal.js";
