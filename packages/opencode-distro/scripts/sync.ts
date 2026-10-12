/** Upstream sync check: verify pinned vendor version, emit drift report as JSON. */
const EXPECTED_HOST = "2.0.26";
const UPSTREAM_REPO = "anomalyco/opencode";

interface DriftReport {
  expectedHost: string;
  vendorVersion: string | null;
  vendorCommit: string | null;
  patchQueueApplies: boolean;
  drift: boolean;
  notes: string[];
}

async function readVendorVersion(upstreamRef: string): Promise<{ version: string | null; commit: string | null }> {
  try {
    const pkg = await Bun.file(`${upstreamRef}/package.json`).json() as { version?: string };
    let commit: string | null = null;
    const proc = Bun.spawnSync(["git", "-C", upstreamRef, "rev-parse", "--short", "HEAD"]);
    if (proc.exitCode === 0) commit = proc.stdout.toString().trim() || null;
    return { version: typeof pkg.version === "string" ? pkg.version : null, commit };
  } catch {
    return { version: null, commit: null };
  }
}

async function checkPatchQueue(distroDir: string): Promise<boolean> {
  // Empty patch queue applies trivially. If patches/ holds *.patch files and a
  // vendor checkout exists, verify with `git apply --check`.
  const glob = new Bun.Glob("patches/*.patch");
  const patches: string[] = [];
  for await (const f of glob.scan({ cwd: distroDir, absolute: true })) patches.push(f);
  if (patches.length === 0) return true;
  const proc = Bun.spawnSync(["git", "apply", "--check", ...patches]);
  return proc.exitCode === 0;
}

export async function buildDriftReport(upstreamRef: string, distroDir: string): Promise<DriftReport> {
  const notes: string[] = [];
  const { version, commit } = await readVendorVersion(upstreamRef);
  if (version === null) notes.push(`vendor package.json unreadable at ${upstreamRef}`);
  else if (version !== EXPECTED_HOST) notes.push(`vendor version ${version} != pinned ${EXPECTED_HOST}`);
  const patchQueueApplies: boolean = await checkPatchQueue(distroDir);
  if (!patchQueueApplies) notes.push("patch queue does not apply cleanly");
  const drift: boolean = version !== EXPECTED_HOST || !patchQueueApplies;
  if (!drift) notes.push("in sync: vendor matches pin, patch queue applies");
  return { expectedHost: EXPECTED_HOST, vendorVersion: version, vendorCommit: commit, patchQueueApplies, drift, notes };
}

const checkOnly: boolean = process.argv.includes("--check");
const upstreamRef: string = process.argv.find((a: string) => a.startsWith("--upstream="))?.split("=")[1]
  ?? `${import.meta.dir}/../../../opencode`;
const report: DriftReport = await buildDriftReport(upstreamRef, import.meta.dir);
console.log(JSON.stringify({ upstream: UPSTREAM_REPO, ...report }, null, 2));
if (checkOnly && report.drift) process.exit(1);
