/** Mechanical gate runner: exec gates from gates.yaml, hash outputs, emit GateReport. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { GateReportSchema, GatesConfigSchema, type GateReport, type GatesConfig } from "../contracts.js";

export const RUNNER_VERSION = "1.0.0";

export interface GateTaskInfo {
  taskId: string;
  commit: string;
  /** Working directory in which gate commands run. Defaults to process.cwd(). */
  workdir?: string;
  /** Diff line count for the budget check. Defaults to 0 (no diff measured). */
  diffLines?: number;
}

interface CheckResult {
  id: string;
  exit: number;
  durationMs: number;
  outputHash: string;
  timedOut: boolean;
}

function sha256Hex(input: string): string {
  return `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
}

function parseGatesYaml(text: string): GatesConfig {
  // Minimal YAML subset: version + list of {id, kind, cmd, timeoutSeconds, cacheKey, maxDiffLines}.
  // Supports the canonical gates.yaml shape only; anything else throws.
  const lines: string[] = text.split("\n");
  let version = 0;
  const gates: Record<string, string | number>[] = [];
  let current: Record<string, string | number> | null = null;
  const scalar = (v: string): string | number => {
    const t: string = v.trim().replace(/^["']|["']$/g, "");
    const n: number = Number(t);
    return t !== "" && Number.isFinite(n) ? n : t;
  };
  for (const raw of lines) {
    const line: string = raw.replace(/#.*$/, "").replace(/\t/g, "  ");
    if (line.trim() === "" || line.trim() === "gates:") continue;
    const versionMatch: RegExpMatchArray | null = /^version:\s*(.+)$/.exec(line.trim());
    if (versionMatch) {
      version = Number(versionMatch[1].trim());
      continue;
    }
    const itemMatch: RegExpMatchArray | null = /^\s*-\s*id:\s*(.+)$/.exec(line);
    if (itemMatch) {
      current = { id: String(scalar(itemMatch[1])) };
      gates.push(current);
      continue;
    }
    const kvMatch: RegExpMatchArray | null = /^\s{2,}(\w+):\s*(.+)$/.exec(line);
    if (kvMatch && current) {
      current[kvMatch[1]] = scalar(kvMatch[2]);
    }
  }
  return GatesConfigSchema.parse({ version, gates });
}

function execWithTimeout(cmd: string, workdir: string, timeoutMs: number): Promise<{ exit: number; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = execFile("sh", ["-c", cmd], { cwd: workdir, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output: string = `${stdout ?? ""}${stderr ?? ""}`;
      if (error && typeof error === "object" && "killed" in error && (error as { killed: boolean }).killed) {
        resolve({ exit: 124, output, timedOut: true });
        return;
      }
      const exit: number = error && typeof error === "object" && "code" in error
        ? Number((error as { code: unknown }).code) || 1
        : 0;
      resolve({ exit, output, timedOut: false });
    });
    child.on("error", (err: Error) => resolve({ exit: 127, output: String(err), timedOut: false }));
  });
}

export async function runGates(configPath: string, taskInfo: GateTaskInfo): Promise<GateReport> {
  const startedAt: string = new Date().toISOString();
  const startMs: number = Date.now();
  const workdir: string = taskInfo.workdir ?? process.cwd();
  const text: string = await readFile(configPath, "utf8");
  const config: GatesConfig = parseGatesYaml(text);

  const checks: CheckResult[] = [];
  let budgetLimit = 0;
  for (const gate of config.gates) {
    if (gate.kind === "budget") {
      budgetLimit = gate.maxDiffLines ?? 0;
      continue;
    }
    if (!gate.cmd) {
      checks.push({ id: gate.id, exit: 1, durationMs: 0, outputHash: sha256Hex("missing cmd"), timedOut: false });
      continue;
    }
    const t0: number = Date.now();
    const result = await execWithTimeout(gate.cmd, workdir, gate.timeoutSeconds * 1000);
    checks.push({
      id: gate.id,
      exit: result.exit,
      durationMs: Date.now() - t0,
      outputHash: sha256Hex(result.output),
      timedOut: result.timedOut,
    });
  }

  const diffLines: number = taskInfo.diffLines ?? 0;
  const budgetFailed: boolean = budgetLimit > 0 && diffLines > budgetLimit;
  const checksFailed: boolean = checks.some((c) => c.exit !== 0);
  const timedOut: boolean = checks.some((c) => c.timedOut);
  const verdict: "pass" | "fail" | "timeout" = timedOut && checksFailed && checks.every((c) => c.exit === 0 || c.timedOut)
    ? "timeout"
    : checksFailed || budgetFailed ? "fail" : "pass";

  const report = {
    taskId: taskInfo.taskId,
    commit: taskInfo.commit,
    runnerVersion: RUNNER_VERSION,
    startedAt,
    durationMs: Date.now() - startMs,
    verdict,
    checks,
    budget: { diffLines, limit: budgetLimit },
    artifacts: [],
  };
  return GateReportSchema.parse(report);
}
