import { spawn } from "node:child_process";

export interface ExecResult {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly env?: Record<string, string | undefined>;
}

const DEFAULT_MAX_OUTPUT = 256 * 1024;

/**
 * Run a command with a first-class timeout outcome. Timeouts report
 * `timedOut: true` with exit 124 — never a null exit.
 */
export function execCmd(argv: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const finish = (exit: number, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      resolve({ exit, stdout, stderr, durationMs: Date.now() - started, timedOut });
    };
    const onData = (chunk: Buffer, sink: "out" | "err"): void => {
      if (bytes >= maxBytes) return;
      const room = maxBytes - bytes;
      const slice = chunk.subarray(0, room);
      bytes += slice.length;
      if (sink === "out") stdout += slice.toString("utf8");
      else stderr += slice.toString("utf8");
    };
    child.stdout.on("data", (c: Buffer) => onData(c, "out"));
    child.stderr.on("data", (c: Buffer) => onData(c, "err"));
    child.on("error", () => finish(127, false));
    child.on("close", (code) => finish(code ?? 1, false));
    const timeoutMs = opts.timeoutMs;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      setTimeout(() => {
        child.kill("SIGKILL");
        finish(124, true);
      }, timeoutMs).unref?.();
    }
  });
}

/** Run through the shell (for configured gate commands). */
export function execShell(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return execCmd(["sh", "-c", cmd], opts);
}
