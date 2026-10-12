import path from "node:path";
import { execCmd } from "../util/exec.js";
import { sha256Hex } from "../util/hash.js";

export interface LaneExecutionRequest {
  taskId: string;
  tier: "bwrap" | "docker" | "dagger";
  image?: string;
  worktreeDir: string;
  command: string[];
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface LaneExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputHash: string;
  durationMs: number;
  timedOut: boolean;
}

/** Pure argv builder (unit-testable). Caller executes via execCmd. */
export function buildLaneArgv(req: LaneExecutionRequest): string[] {
  const image = req.image ?? "lane-base:latest";
  if (req.tier === "docker" || req.tier === "dagger") {
    // Dagger tier: no daemon-less `dagger run` available inside a lane host
    // without credentials; run the same hermetic container shape via docker
    // with its image and mark the tier in the environment so provenance is
    // visible. Documented here rather than faked elsewhere.
    const argv = ["docker", "run", "--rm", "-v", `${req.worktreeDir}:/work`, "-w", "/work"];
    if (req.tier === "dagger") argv.push("-e", "DAGGER_TIER=1");
    if (req.env) {
      for (const [k, v] of Object.entries(req.env)) argv.push("-e", `${k}=${v}`);
    }
    argv.push(image, ...req.command);
    return argv;
  }
  // bwrap tier: read-only root, worktree bound at /tmp. /tmp is used as
  // the mount point (not /work) because bwrap cannot create a fresh
  // mount point under a read-only root bind, while /tmp is
  // FHS-guaranteed to exist so the bind succeeds. --die-with-parent
  // ensures the sandbox dies with the supervisor on timeout.
  // When bwrap is absent (CI hosts), executeInLane falls back to direct
  // local execution with cwd=worktreeDir — still a real child_process.
  return [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--bind",
    req.worktreeDir,
    "/tmp",
    "--chdir",
    "/tmp",
    "--die-with-parent",
    "--",
    ...req.command,
  ];
}

export async function toolAvailable(bin: string): Promise<boolean> {
  const res = await execCmd(["sh", "-c", `command -v ${bin}`]);
  return res.exit === 0;
}

/** Execute a task command in a lane. Always spawns a real child process. */
export async function executeInLane(req: LaneExecutionRequest): Promise<LaneExecutionResult> {
  if (!req.command || req.command.length === 0) throw new Error("lane command must be non-empty");
  if (!path.isAbsolute(req.worktreeDir)) throw new Error(`worktreeDir must be absolute: ${req.worktreeDir}`);
  const started = Date.now();
  const env = req.env ? { ...req.env } : undefined;

  if (req.tier === "bwrap" && !(await toolAvailable("bwrap"))) {
    // Fallback: direct local execution with cwd=worktreeDir.
    const res = await execCmd(req.command, { cwd: req.worktreeDir, timeoutMs: req.timeoutMs, env });
    return {
      exitCode: res.timedOut ? 124 : res.exit,
      stdout: res.stdout,
      stderr: res.stderr,
      outputHash: `sha256:${sha256Hex(`${res.stdout}\n${res.stderr}`)}`,
      durationMs: Date.now() - started,
      timedOut: res.timedOut,
    };
  }

  const argv = buildLaneArgv(req);
  const res = await execCmd(argv, { cwd: req.worktreeDir, timeoutMs: req.timeoutMs, env });
  return {
    exitCode: res.timedOut ? 124 : res.exit,
    stdout: res.stdout,
    stderr: res.stderr,
    outputHash: `sha256:${sha256Hex(`${res.stdout}\n${res.stderr}`)}`,
    durationMs: Date.now() - started,
    timedOut: res.timedOut,
  };
}
