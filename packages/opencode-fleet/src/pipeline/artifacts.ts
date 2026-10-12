import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TaskSchema } from "../state/types.js";
import type { Mission, Task } from "../state/types.js";
import { validateDag } from "../dag/graph.js";
import { MISSION_FILE, REPORTS_DIR, RESEARCH_FILE, SPEC_FILE, TASKS_FILE } from "./stages.js";

/** Mission directory: `.fleet/missions/<id>/` (or any dir passed in). */
export const missionDir = (root: string, missionId: string): string =>
  path.join(root, ".fleet", "missions", missionId);

export async function writeMission(dir: string, markdown: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, MISSION_FILE);
  await writeFile(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  return file;
}

export async function writeResearch(dir: string, markdown: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, RESEARCH_FILE);
  await writeFile(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  return file;
}

export async function writeSpec(dir: string, markdown: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, SPEC_FILE);
  await writeFile(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  return file;
}

export interface TasksFile {
  readonly tasks: Task[];
}

/** Write tasks.json after schema + DAG validation. */
export async function writeTasks(dir: string, tasks: Task[]): Promise<string> {
  for (const t of tasks) {
    const parsed = TaskSchema.safeParse(t);
    if (!parsed.success) throw new Error(`invalid task ${JSON.stringify(t.id)}: ${parsed.error.message}`);
  }
  validateDag(tasks);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, TASKS_FILE);
  await writeFile(file, JSON.stringify({ tasks } satisfies TasksFile, null, 2), "utf8");
  return file;
}

/** Read and validate tasks.json. */
export async function readTasks(dir: string): Promise<Task[]> {
  const raw = JSON.parse(await readFile(path.join(dir, TASKS_FILE), "utf8")) as TasksFile;
  const tasks = raw.tasks.map((t) => {
    const parsed = TaskSchema.safeParse(t);
    if (!parsed.success) throw new Error(`invalid task: ${parsed.error.message}`);
    return parsed.data;
  });
  validateDag(tasks);
  return tasks;
}

export async function readTextArtifact(dir: string, file: string): Promise<string> {
  return readFile(path.join(dir, file), "utf8");
}

/** Write a judge or gate report JSON under reports/. */
export async function writeReport(dir: string, name: string, report: unknown): Promise<string> {
  const reports = path.join(dir, REPORTS_DIR);
  await mkdir(reports, { recursive: true });
  const safe = name.replace(/[^a-z0-9_.-]+/gi, "_");
  const file = path.join(reports, safe.endsWith(".json") ? safe : `${safe}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

/** Parse the criteria checklist out of a mission.md (lines starting with - [ ]). */
export function parseMissionCriteria(markdown: string): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\s*-\s*\[\s\]\s*\((cmd|judge|human)\)\s+(.+?)\s*$/);
    if (m) out.push({ label: m[1]!, text: m[2]! });
  }
  return out;
}

/** Build a Mission record from mission.md content. */
export function missionFromMarkdown(id: string, markdown: string): Mission {
  const intent = markdown.split("\n").find((l) => l.startsWith("Intent:"))?.replace(/^Intent:\s*/, "") ?? id;
  const criteria = parseMissionCriteria(markdown).map((c, i) => ({
    id: `c${i + 1}`,
    text: c.text,
    verify: c.label as "cmd" | "judge" | "human",
    status: "unmet" as const,
  }));
  return { id, intent, acceptance: criteria, state: "pending" };
}
