import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Journal,
  appendJournalEvent,
  loadJournal,
  resumeMission,
  saveJournal,
  saveSnapshot,
  verifyJournalFile,
} from "../src/state/index.js";
import { makeTask } from "../src/state/index.js";

async function missionDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "fleet-journal-"));
}

describe("Journal", () => {
  test("append then verify passes", async () => {
    const dir = await missionDir();
    const j = new Journal();
    j.append("mission.grilled", { missionId: "m-1" }, "operator");
    j.append("task.started", { taskId: "t-1" });
    expect(j.verify().ok).toBe(true);
    await saveJournal(dir, j);
    expect((await verifyJournalFile(dir)).ok).toBe(true);
    const loaded = await loadJournal(dir);
    expect(loaded.length).toBe(2);
    expect(loaded.verify().ok).toBe(true);
  });

  test("tamper detection: edited payload fails verify", async () => {
    const dir = await missionDir();
    const j = new Journal();
    j.append("task.done", { taskId: "t-1" });
    await saveJournal(dir, j);
    const file = path.join(dir, "journal.jsonl");
    const text = await readFile(file, "utf8");
    const tampered = text.replace("task.done", "task.done-hacked");
    await writeFile(file, tampered, "utf8");
    expect((await verifyJournalFile(dir)).ok).toBe(false);
    await expect(loadJournal(dir)).rejects.toThrow(/corrupt/);
  });

  test("tamper detection: truncated chain prefix still verifies, appended forgery fails", () => {
    const j = new Journal();
    j.append("a");
    j.append("b");
    const clone = Journal.fromJSONL(j.toJSONL());
    expect(clone.verify().ok).toBe(true);
    // Forge: splice in an entry with a wrong prevHash.
    const entries = clone.list();
    const forged = Journal.fromJSONL(
      `${JSON.stringify(entries[0])}\n${JSON.stringify({ ...entries[1]!, prevHash: "00".repeat(32) })}\n`,
    );
    expect(forged.verify().ok).toBe(false);
  });

  test("snapshot round-trip + resume", async () => {
    const dir = await missionDir();
    const j = new Journal();
    j.append("mission.grilled", { missionId: "m-1" }, "operator");
    const mission = { id: "m-1", intent: "ship it", acceptance: [], state: "active" as const };
    const taskList = [makeTask({ id: "t-1", missionId: "m-1" })];
    await saveJournal(dir, j);
    await saveSnapshot(dir, mission, taskList, j);
    // Post-snapshot event: resume must surface it as tail.
    await appendJournalEvent(dir, "task.started", { taskId: "t-1" });
    const resumed = await resumeMission(dir);
    expect(resumed.mission.id).toBe("m-1");
    expect(resumed.tasks.map((t) => t.id)).toEqual(["t-1"]);
    expect(resumed.tail.map((e) => e.event)).toEqual(["task.started"]);
    expect(resumed.snapshotDiverged).toBe(true);
  });

  test("resume without snapshot throws a helpful error", async () => {
    await expect(resumeMission(await missionDir())).rejects.toThrow(/no snapshot/);
  });
});
