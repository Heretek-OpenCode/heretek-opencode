import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(
  import.meta.dir,
  "..",
  "scripts",
  "validate-commit.sh",
);

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

async function git(dir: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

async function runHook(dir: string): Promise<{ code: number; text: string }> {
  const proc = Bun.spawn(["bash", SCRIPT], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, VALIDATE_COMMIT_RUN_TESTS: "0" },
  });
  const code = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { code, text: `${out}\n${err}` };
}

async function sandbox(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "godot-vc-"));
  scratch.push(dir);
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@t.t");
  await git(dir, "config", "user.name", "t");
  return dir;
}

describe("validate-commit hook", () => {
  test("bad JSON blocks", async () => {
    const dir = await sandbox();
    writeFileSync(join(dir, "table.json"), '{"a":}\n');
    await git(dir, "add", "table.json");
    const r = await runHook(dir);
    expect(r.code).not.toBe(0);
    expect(r.text).toMatch(/invalid JSON/i);
  });

  test("good passes", async () => {
    const dir = await sandbox();
    writeFileSync(join(dir, "table.json"), '{"a":1}\n');
    writeFileSync(join(dir, "player.gd"), "extends Node\nvar hp: int = 3\n");
    await git(dir, "add", "table.json", "player.gd");
    const r = await runHook(dir);
    expect(r.code).toBe(0);
  });

  test("gdscript type slip blocks", async () => {
    const dir = await sandbox();
    writeFileSync(join(dir, "bad.gd"), 'extends Node\nvar hp: int = "oops"\n');
    await git(dir, "add", "bad.gd");
    const r = await runHook(dir);
    expect(r.code).not.toBe(0);
    expect(r.text).toMatch(/type mismatch/i);
  });

  test("conflict markers block", async () => {
    const dir = await sandbox();
    writeFileSync(join(dir, "c.gd"), "<<<<<<< HEAD\nfoo\n=======\nbar\n");
    await git(dir, "add", "c.gd");
    const r = await runHook(dir);
    expect(r.code).not.toBe(0);
    expect(r.text).toMatch(/conflict/i);
  });
});
