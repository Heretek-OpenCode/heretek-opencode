#!/usr/bin/env bun
/** Minimal fleet CLI: grill | research | spec | run | status | approve | resume | steer. */
import { parseArgs } from "node:util";
import { appendJournalEvent, loadJournal, resumeMission, saveJournal, saveSnapshot } from "../state/journal.js";
import { makeTask } from "../state/types.js";
import type { Mission, Task } from "../state/types.js";
import { missionDir, missionFromMarkdown, readTasks, readTextArtifact, writeMission, writeResearch, writeSpec, writeTasks } from "../pipeline/artifacts.js";
import { MISSION_FILE, TASKS_FILE } from "../pipeline/stages.js";
import { runToCompletion } from "../scheduler/runner.js";
import type { TaskOutcome } from "../scheduler/runner.js";

const COMMANDS = ["grill", "research", "spec", "run", "status", "approve", "resume", "steer"] as const;
type Command = (typeof COMMANDS)[number];

function usage(): string {
  return [
    "fleet <command> [options]",
    "",
    "Commands:",
    "  grill    --mission <id> --intent <text>     start a mission (writes mission.md)",
    "  research --mission <id> --notes <text>      record research (writes research.md)",
    "  spec     --mission <id>                     write spec.md + tasks.json skeleton",
    "  run      --mission <id>                     run the task DAG to settlement",
    "  status   --mission <id>                     show mission + task states",
    "  approve  --mission <id> --criterion <cid>   record a human waiver for a criterion",
    "  resume   --mission <id>                     replay journal tail after a crash",
    "  steer    --mission <id> --note <text>       append an operator steer event",
    "",
    "Options: --root <dir> (default .), --mission <id> (default m-1)",
  ].join("\n");
}

function fail(msg: string): never {
  console.error(`fleet: ${msg}\n\n${usage()}`);
  process.exit(1);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(usage());
    return;
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) fail(`unknown command ${JSON.stringify(cmd)}`);
  const { values } = parseArgs({
    args: rest,
    options: {
      root: { type: "string", default: "." },
      mission: { type: "string", default: "m-1" },
      intent: { type: "string" },
      notes: { type: "string" },
      note: { type: "string" },
      criterion: { type: "string" },
    },
    strict: true,
  });
  const dir = missionDir(values.root!, values.mission!);
  await runCommand(cmd as Command, dir, values as Record<string, string | undefined>);
}

async function runCommand(cmd: Command, dir: string, v: Record<string, string | undefined>): Promise<void> {
  const missionId = dir.split("/").pop()!;
  switch (cmd) {
    case "grill": {
      if (!v.intent) fail("grill needs --intent");
      const md = `# Mission: ${missionId}\nIntent: ${v.intent}\n## Acceptance criteria\n- [ ] (human) ${v.intent}\n`;
      await writeMission(dir, md);
      const mission = missionFromMarkdown(missionId, md);
      const journal = await loadJournal(dir);
      journal.append("mission.grilled", { missionId }, "operator");
      await saveJournal(dir, journal);
      await saveSnapshot(dir, mission, [], journal);
      console.log(`mission ${missionId}: mission.md written`);
      break;
    }
    case "research": {
      const md = `# Research: ${missionId}\n## Claims\n- [inferred] ${v.notes ?? "pending operator notes"}\n`;
      await writeResearch(dir, md);
      await appendJournalEvent(dir, "research.recorded", { missionId }, "operator");
      console.log(`mission ${missionId}: research.md written`);
      break;
    }
    case "spec": {
      const mission = await loadMission(dir, missionId);
      const tasks: Task[] = [
        { ...makeTask({ id: "t-001", missionId, stage: "build" }), state: "pending" as const },
      ];
      await writeSpec(dir, `# Spec: ${missionId}\n\nSee ${TASKS_FILE} for the task DAG.\n`);
      await writeTasks(dir, tasks);
      const journal = await loadJournal(dir);
      journal.append("spec.written", { tasks: tasks.map((t) => t.id) });
      await saveJournal(dir, journal);
      await saveSnapshot(dir, { ...mission, state: "active" }, tasks, journal);
      console.log(`mission ${missionId}: spec.md + tasks.json (${tasks.length} task)`);
      break;
    }
    case "run": {
      const { mission, tasks } = await resumeMission(dir);
      const summary = await runToCompletion(tasks, async (): Promise<TaskOutcome> => ({
        gatesPass: true,
        functional: "pass",
        adversarial: "pass",
      }));
      const journal = await loadJournal(dir);
      journal.append("run.completed", { done: summary.done, waitingHuman: summary.waitingHuman });
      await saveJournal(dir, journal);
      await saveSnapshot(
        dir,
        { ...mission, state: summary.done ? "done" : "blocked" },
        summary.tasks,
        journal,
      );
      console.log(`run: done=${summary.done} waiting_human=[${summary.waitingHuman.join(",")}] steps=${summary.steps}`);
      if (!summary.done) process.exitCode = 1;
      break;
    }
    case "status": {
      const { mission, tasks, snapshotDiverged } = await resumeMission(dir);
      console.log(`mission ${mission.id}: ${mission.state}${snapshotDiverged ? " (snapshot diverged; journal is truth)" : ""}`);
      for (const t of tasks) console.log(`  ${t.id} [${t.stage}] ${t.state} attempts=${t.attempts} deps=[${t.deps.join(",")}]`);
      const journal = await loadJournal(dir);
      console.log(`journal: ${journal.length} entries, tip ${journal.tipHash.slice(0, 12)}`);
      break;
    }
    case "approve": {
      if (!v.criterion) fail("approve needs --criterion <id>");
      const { mission, tasks } = await resumeMission(dir);
      const next: Mission = {
        ...mission,
        acceptance: mission.acceptance.map((c) => (c.id === v.criterion ? { ...c, status: "waived_by_human" as const } : c)),
      };
      const journal = await loadJournal(dir);
      journal.append("criterion.waived", { criterion: v.criterion }, "operator");
      await saveJournal(dir, journal);
      await saveSnapshot(dir, next, tasks, journal);
      console.log(`criterion ${v.criterion} waived by human`);
      break;
    }
    case "resume": {
      const { tail, snapshotDiverged } = await resumeMission(dir);
      console.log(`replaying ${tail.length} journal ${tail.length === 1 ? "entry" : "entries"} after snapshot`);
      for (const e of tail) console.log(`  #${e.seq} ${e.at} ${e.actor} ${e.event}`);
      if (snapshotDiverged) console.log("snapshot diverged: rebuilt view from journal");
      break;
    }
    case "steer": {
      if (!v.note) fail("steer needs --note");
      await appendJournalEvent(dir, "operator.steer", { note: v.note }, "operator");
      console.log("steer event recorded");
      break;
    }
  }
}

async function loadMission(dir: string, missionId: string): Promise<Mission> {
  try {
    const { mission } = await resumeMission(dir);
    return mission;
  } catch {
    const md = await readTextArtifact(dir, MISSION_FILE).catch(() => `# Mission: ${missionId}\nIntent: ${missionId}\n`);
    return missionFromMarkdown(missionId, md);
  }
}


if (import.meta.main) {
  await main();
}
