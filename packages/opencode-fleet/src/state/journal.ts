import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Mission, Task } from "./types.js";
import { GENESIS_HASH, canonicalJson, chainHash, sha256Hex } from "../util/hash.js";
import { redactJson } from "../util/redact.js";

/**
 * Journal-first durability. Every state transition appends one JSONL line:
 * `{ seq, at, actor, event, data, prevHash, hash }` where
 * `hash = sha256(prevHash + canonical({seq,at,actor,event,data}))`.
 * Tamper-evident via hash chain; plain sha256 only.
 */

export interface JournalEntry {
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
  readonly event: string;
  readonly data?: unknown;
  readonly prevHash: string;
  readonly hash: string;
}

export interface VerifyResult {
  readonly ok: boolean;
  /** 1-based line number of the first bad entry, when !ok. */
  readonly badLine?: number;
  readonly reason?: string;
}

export function entryHash(e: Omit<JournalEntry, "hash">): string {
  return chainHash(e.prevHash, { seq: e.seq, at: e.at, actor: e.actor, event: e.event, data: e.data });
}

export function parseJournalLine(line: string): JournalEntry {
  const raw = JSON.parse(line) as JournalEntry;
  if (
    typeof raw.seq !== "number" ||
    typeof raw.at !== "string" ||
    typeof raw.actor !== "string" ||
    typeof raw.event !== "string" ||
    typeof raw.prevHash !== "string" ||
    typeof raw.hash !== "string"
  ) {
    throw new Error("malformed journal entry");
  }
  return raw;
}

/** Verify a parsed entry sequence: ordering, linkage, and hashes. */
export function verifyEntries(entries: JournalEntry[]): VerifyResult {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.seq !== i + 1) return { ok: false, badLine: i + 1, reason: `bad seq ${e.seq}, want ${i + 1}` };
    if (e.prevHash !== prev) return { ok: false, badLine: i + 1, reason: "prevHash mismatch" };
    if (e.hash !== entryHash(e)) return { ok: false, badLine: i + 1, reason: "hash mismatch" };
    prev = e.hash;
  }
  return { ok: true };
}

export class Journal {
  private entries: JournalEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  get tipHash(): string {
    return this.entries.length === 0 ? GENESIS_HASH : this.entries[this.entries.length - 1]!.hash;
  }

  /** Append an event; secrets in data are redacted before hashing. */
  append(event: string, data?: unknown, actor = "fleet"): JournalEntry {
    const entry: JournalEntry = {
      seq: this.entries.length + 1,
      at: new Date().toISOString(),
      actor,
      event,
      data: data === undefined ? undefined : redactJson(data),
      prevHash: this.tipHash,
      hash: "",
    };
    (entry as { hash: string }).hash = entryHash(entry);
    this.entries.push(entry);
    return entry;
  }

  list(): JournalEntry[] {
    return [...this.entries];
  }

  verify(): VerifyResult {
    return verifyEntries(this.entries);
  }

  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n") + (this.entries.length ? "\n" : "");
  }

  static fromJSONL(text: string): Journal {
    const j = new Journal();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) j.entries.push(parseJournalLine(trimmed));
    }
    return j;
  }
}

/** Mission file layout under `.fleet/missions/<id>/`. */
export const journalPath = (missionDir: string): string => path.join(missionDir, "journal.jsonl");
export const snapshotPath = (missionDir: string): string => path.join(missionDir, "state.json");

export interface Snapshot {
  readonly v: 1;
  readonly mission: Mission;
  readonly tasks: Task[];
  /** Journal length and tip covered by this snapshot. */
  readonly journalLength: number;
  readonly journalTip: string;
}

/** Persist the journal to disk (append-only write of the full chain). */
export async function saveJournal(missionDir: string, journal: Journal): Promise<void> {
  await mkdir(missionDir, { recursive: true });
  await writeFile(journalPath(missionDir), journal.toJSONL(), "utf8");
}

/** Append a single entry directly to the on-disk journal. */
export async function appendJournalEvent(
  missionDir: string,
  event: string,
  data?: unknown,
  actor = "fleet",
): Promise<JournalEntry> {
  const journal = await loadJournal(missionDir);
  const entry = journal.append(event, data, actor);
  await appendFile(journalPath(missionDir), `${JSON.stringify(entry)}\n`, "utf8").catch(async (err: unknown) => {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      await saveJournal(missionDir, journal);
    } else throw err;
  });
  return entry;
}

/** Load and verify the on-disk journal; empty journal when missing. */
export async function loadJournal(missionDir: string): Promise<Journal> {
  let text: string;
  try {
    text = await readFile(journalPath(missionDir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return new Journal();
    throw err;
  }
  const journal = Journal.fromJSONL(text);
  const check = journal.verify();
  if (!check.ok) throw new Error(`journal corrupt at line ${check.badLine}: ${check.reason}`);
  return journal;
}

/** Verify the on-disk journal without loading state. */
export async function verifyJournalFile(missionDir: string): Promise<VerifyResult> {
  try {
    const text = await readFile(journalPath(missionDir), "utf8");
    return verifyEntries(Journal.fromJSONL(text).list());
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { ok: true };
    throw err;
  }
}

/** Write a snapshot; records the journal tip so resume can detect divergence. */
export async function saveSnapshot(missionDir: string, mission: Mission, tasks: Task[], journal: Journal): Promise<void> {
  await mkdir(missionDir, { recursive: true });
  const snapshot: Snapshot = {
    v: 1,
    mission,
    tasks,
    journalLength: journal.length,
    journalTip: journal.tipHash,
  };
  const tmp = `${snapshotPath(missionDir)}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  await rename(tmp, snapshotPath(missionDir));
}

export interface ResumeState {
  readonly mission: Mission;
  readonly tasks: Task[];
  /** Journal entries after the snapshot (to replay). */
  readonly tail: JournalEntry[];
  readonly snapshotDiverged: boolean;
}

/**
 * Resume: load snapshot + journal, verify the chain, and report entries
 * written after the snapshot. A diverged snapshot (tip mismatch) is still
 * usable — the journal is the source of truth.
 */
export async function resumeMission(missionDir: string): Promise<ResumeState> {
  const journal = await loadJournal(missionDir);
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(await readFile(snapshotPath(missionDir), "utf8")) as Snapshot;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(`no snapshot in ${missionDir}: replay the journal or re-run spec`);
    }
    throw err;
  }
  if (snapshot.v !== 1) throw new Error(`unsupported snapshot version ${JSON.stringify((snapshot as { v?: unknown }).v)}`);
  const diverged = snapshot.journalTip !== journal.tipHash && snapshot.journalLength !== journal.length;
  const tail = journal.list().slice(snapshot.journalLength);
  void sha256Hex(canonicalJson(snapshot));
  return { mission: snapshot.mission, tasks: snapshot.tasks, tail, snapshotDiverged: diverged };
}
