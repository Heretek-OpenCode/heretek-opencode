import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Patch-stack rebase discipline (donor issue #13): every patch in patches/
 * must apply cleanly onto a pristine tree. Each patch is checked with
 * `git apply --check` inside a fresh empty repo so the verification is
 * independent of whatever checkout runs it.
 */
const thisDir = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(thisDir, "..", "patches");

function checkPatch(path: string): { ok: boolean; output: string } {
  const workdir = mkdtempSync(join(tmpdir(), "gdevelop-patch-check-"));
  try {
    const init = spawnSync("git", ["init", "-q", "."], { cwd: workdir });
    if (init.status !== 0) {
      return { ok: false, output: `git init failed: ${init.stderr.toString()}` };
    }
    const check = spawnSync("git", ["apply", "--check", path], { cwd: workdir });
    const output = `${check.stdout.toString()}${check.stderr.toString()}`.trim();
    return { ok: check.status === 0, output };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

const patches = readdirSync(patchesDir)
  .filter((f) => f.endsWith(".patch"))
  .sort();

if (patches.length === 0) {
  console.error("verify-patches: no patches found");
  process.exit(1);
}

let failed = 0;
for (const patch of patches) {
  const result = checkPatch(join(patchesDir, patch));
  if (result.ok) {
    console.log(`ok   ${patch}`);
  } else {
    failed += 1;
    console.error(`FAIL ${patch}${result.output ? `: ${result.output}` : ""}`);
  }
}

if (failed > 0) {
  console.error(`verify-patches: ${failed}/${patches.length} patches do not apply cleanly`);
  process.exit(1);
}
console.log(`verify-patches: ${patches.length}/${patches.length} patches apply cleanly`);
