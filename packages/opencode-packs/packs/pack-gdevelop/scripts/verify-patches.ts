import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Patch-stack verifier for the GDevelop domain pack.
 *
 * The 14 patches in patches/ are unified diffs against upstream GDevelop
 * source (`--- a/...` / `+++ b/...` headers + `@@` hunks, no `diff --git`
 * headers). They target files that only exist in an upstream GDevelop
 * checkout, so they CANNOT be `git apply --check`ed against this repo —
 * structural verification is the correct discipline here:
 *
 * (a) exactly the 14 expected patch filenames exist;
 * (b) each patch is non-empty, contains `--- a/` + `+++ b/` headers and at
 *     least one `@@` hunk;
 * (c) no patch contains stub markers (case-insensitive "stub");
 * (d) patches/README.md and patches/REBASE.md exist.
 */
const thisDir = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(thisDir, "..", "patches");

const EXPECTED_PATCHES = [
  "01-usage-predicate.patch",
  "02-auth-context-seed.patch",
  "03-subscription-checker.patch",
  "04-loading-screen.patch",
  "05-preview-debugger.patch",
  "06-electron-hook.patch",
  "07-generation-glue.patch",
  "08-preferences-ai.patch",
  "09-prepare-ai-content.patch",
  "10-ai-chat-affordance.patch",
  "11-studio-runtime-mount.patch",
  "12-ai-request-utils.patch",
  "13-ai-request-context.patch",
  "14-ai-utils.patch",
];

let failed = 0;
const fail = (msg: string) => {
  failed += 1;
  console.error(`FAIL ${msg}`);
};
const ok = (msg: string) => console.log(`ok   ${msg}`);

// (a) exact filename set
const onDisk = readdirSync(patchesDir)
  .filter((f) => f.endsWith(".patch"))
  .sort();
const missing = EXPECTED_PATCHES.filter((f) => !onDisk.includes(f));
const extra = onDisk.filter((f) => !EXPECTED_PATCHES.includes(f));
if (missing.length === 0 && extra.length === 0) {
  ok(`patch set: exactly the ${EXPECTED_PATCHES.length} expected patches`);
} else {
  if (missing.length > 0) fail(`missing patches: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`unexpected patches: ${extra.join(", ")}`);
}

for (const patch of EXPECTED_PATCHES) {
  const path = join(patchesDir, patch);
  if (!existsSync(path)) continue; // already reported above
  const text = readFileSync(path, "utf8");
  // (b) non-empty + unified-diff structure
  if (text.length === 0) {
    fail(`${patch}: file is empty`);
    continue;
  }
  const hasMinus = text.includes("--- a/");
  const hasPlus = text.includes("+++ b/");
  const hasHunk = /^@@ /m.test(text);
  if (!hasMinus || !hasPlus || !hasHunk) {
    fail(
      `${patch}: missing unified-diff structure` +
        `${hasMinus ? "" : " (no '--- a/' header)"}` +
        `${hasPlus ? "" : " (no '+++ b/' header)"}` +
        `${hasHunk ? "" : " (no '@@' hunk)"}`,
    );
    continue;
  }
  // (c) no stub markers
  if (/stub/i.test(text)) {
    fail(`${patch}: contains a stub marker`);
    continue;
  }
  ok(`${patch}: headers + hunk present, no stubs (${text.length} bytes)`);
}

// (d) docs present
for (const doc of ["README.md", "REBASE.md"]) {
  const path = join(patchesDir, doc);
  if (existsSync(path) && readFileSync(path, "utf8").length > 0) {
    ok(`${doc} present`);
  } else {
    fail(`${doc} missing or empty`);
  }
}

if (failed > 0) {
  console.error(`verify-patches: ${failed} check(s) failed`);
  process.exit(1);
}
console.log(
  `verify-patches: ${EXPECTED_PATCHES.length}/${EXPECTED_PATCHES.length} patches verified`,
);
