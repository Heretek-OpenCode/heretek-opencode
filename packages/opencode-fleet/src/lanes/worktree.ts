import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execCmd } from "../util/exec.js";
import { integrationBranch, salvageRef, taskBranch } from "../state/types.js";

export interface WorktreeInfo {
  readonly taskId: string;
  readonly branch: string;
  readonly dir: string;
  readonly salvage?: string;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const res = await execCmd(["git", ...args], { cwd: repoRoot, timeoutMs: 60_000 });
  if (res.exit !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim().slice(0, 500)}`);
  return res.stdout.trim();
}

export function checkSlug(kind: string, value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${kind} ${JSON.stringify(value)} is not a slug`);
}

/** Create a git worktree for a task on `fleet/<taskId>`. Anchors a salvage ref first. */
export async function createWorktree(repoRoot: string, taskId: string, baseDir: string): Promise<WorktreeInfo> {
  checkSlug("task id", taskId);
  const branch = taskBranch(taskId);
  const dir = path.join(baseDir, taskId);
  await mkdir(baseDir, { recursive: true });
  const existing = await execCmd(["git", "rev-parse", "--verify", branch], { cwd: repoRoot });
  if (existing.exit === 0) {
    await git(repoRoot, ["worktree", "add", "--detach", dir]);
    await git(repoRoot, ["branch", "-f", branch, "HEAD"]).catch(() => {});
  } else {
    await git(repoRoot, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  }
  const tip = await revParse(repoRoot, branch).catch(() => undefined);
  return { taskId, branch, dir, salvage: tip };
}

/** Remove a task worktree. Set `salvage` to anchor the tip at refs/fleet-salvage/<taskId> first. */
export async function destroyWorktree(repoRoot: string, info: WorktreeInfo, opts: { salvage?: boolean } = {}): Promise<void> {
  if (opts.salvage !== false) await salvageBranch(repoRoot, info.branch, info.taskId).catch(() => undefined);
  await execCmd(["git", "worktree", "remove", "--force", info.dir], { cwd: repoRoot, timeoutMs: 60_000 });
  await rm(info.dir, { recursive: true, force: true });
}

/** Anchor a branch tip at refs/fleet-salvage/<taskId> so work is never lost. */
export async function salvageBranch(repoRoot: string, branch: string, taskId: string): Promise<string | undefined> {
  checkSlug("task id", taskId);
  const exists = await execCmd(["git", "rev-parse", "--verify", branch], { cwd: repoRoot });
  if (exists.exit !== 0) return undefined;
  const tip = await revParse(repoRoot, branch);
  await git(repoRoot, ["update-ref", salvageRef(taskId), tip]);
  return tip;
}

/** Read the anchored salvage tip for a task, if any. */
export async function readSalvageRef(repoRoot: string, taskId: string): Promise<string | undefined> {
  checkSlug("task id", taskId);
  const res = await execCmd(["git", "rev-parse", "--verify", salvageRef(taskId)], { cwd: repoRoot });
  return res.exit === 0 ? res.stdout.trim() : undefined;
}

export async function revParse(repoRoot: string, ref: string): Promise<string> {
  return git(repoRoot, ["rev-parse", ref]);
}

export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const res = await execCmd(["git", "rev-parse", "--verify", branch], { cwd: repoRoot });
  return res.exit === 0;
}

/** Count changed lines (additions + deletions) of a branch vs its merge base with main. */
export async function diffLineCount(repoRoot: string, branch: string, main = "main"): Promise<number> {
  const base = await git(repoRoot, ["merge-base", main, branch]).catch(() => main);
  const res = await execCmd(["git", "diff", "--numstat", `${base}..${branch}`], { cwd: repoRoot });
  if (res.exit !== 0) return 0;
  let total = 0;
  for (const line of res.stdout.split("\n")) {
    const m = line.match(/^(\d+)\s+(\d+)\s+/);
    if (m) total += Number(m[1]) + Number(m[2]);
  }
  return total;
}

/** Integration branch helpers for the Human PR stage. */
export async function ensureIntegrationBranch(repoRoot: string, missionId: string, main = "main"): Promise<string> {
  const branch = integrationBranch(missionId);
  if (!(await branchExists(repoRoot, branch))) await git(repoRoot, ["branch", branch, main]);
  return branch;
}
