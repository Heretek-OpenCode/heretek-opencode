import type { GateReport } from "../state/types.js";
import { GateReportSchema } from "../state/types.js";
import { execShell } from "../util/exec.js";
import type { ExecResult } from "../util/exec.js";
import { sha256Hex } from "../util/hash.js";
import { redactSecrets } from "../util/redact.js";

/**
 * Mechanical gate runner: deterministic checks with identical GateReport
 * shape locally and in CI. Evidence = exit codes + output hashes + commit
 * SHA. A failed gate is never waived by an agent — only an operator records
 * a human waiver, and it stays visible in the PR.
 */

export const GATE_RUNNER_VERSION = "1.0.0";

export type GateKind = "lint" | "typecheck" | "tests-changed" | "security" | "budget" | "custom";

export interface GateDef {
  readonly id: string;
  readonly kind: GateKind;
  /** Shell command; omitted for budget gates. */
  readonly cmd?: string;
  readonly timeoutMs?: number;
}

export interface GateCheck {
  readonly id: string;
  readonly exit: number;
  readonly durationMs: number;
  readonly outputHash: string;
  readonly timedOut: boolean;
  readonly outputExcerpt: string;
}

export const DEFAULT_GATES: GateDef[] = [
  { id: "lint", kind: "lint", cmd: "bunx biome check .", timeoutMs: 120_000 },
  { id: "typecheck", kind: "typecheck", cmd: "bunx tsc --noEmit", timeoutMs: 300_000 },
  { id: "tests-changed", kind: "tests-changed", cmd: "bun test", timeoutMs: 600_000 },
  { id: "security", kind: "security", cmd: "osv-scanner -r .", timeoutMs: 300_000 },
  { id: "budget", kind: "budget" },
];

function toCheck(id: string, res: ExecResult): GateCheck {
  const combined = redactSecrets(`${res.stdout}\n${res.stderr}`.slice(0, 4000));
  return {
    id,
    exit: res.timedOut ? 124 : res.exit,
    durationMs: res.durationMs,
    outputHash: `sha256:${sha256Hex(combined)}`,
    timedOut: res.timedOut,
    outputExcerpt: combined.slice(0, 1000),
  };
}

/** Run one gate. Budget gates are evaluated via checkBudget instead. */
export async function runGate(def: GateDef, cwd: string): Promise<GateCheck> {
  if (def.kind === "budget" || !def.cmd) {
    return { id: def.id, exit: 0, durationMs: 0, outputHash: `sha256:${sha256Hex("")}`, timedOut: false, outputExcerpt: "" };
  }
  const res = await execShell(def.cmd, { cwd, timeoutMs: def.timeoutMs ?? 300_000 });
  return toCheck(def.id, res);
}

/** Run every gate sequentially; per-task caching key is the caller's job. */
export async function runGates(defs: GateDef[], cwd: string): Promise<GateCheck[]> {
  const checks: GateCheck[] = [];
  for (const def of defs) checks.push(await runGate(def, cwd));
  return checks;
}

export interface BudgetState {
  readonly diffLines: number;
  readonly limit: number;
}

/** Budget enforcement: over-limit diffs fail the gate. */
export function checkBudget(diffLines: number, limit: number): { ok: boolean; check: GateCheck } {
  const ok = diffLines <= limit;
  const excerpt = `diffLines=${diffLines} limit=${limit}`;
  return {
    ok,
    check: {
      id: "budget",
      exit: ok ? 0 : 1,
      durationMs: 0,
      outputHash: `sha256:${sha256Hex(excerpt)}`,
      timedOut: false,
      outputExcerpt: excerpt,
    },
  };
}

/** Minimal test-output summary: picks up bun/vitest failure counts. */
export function summarizeTestOutput(output: string): { failed: number; passed: number } {
  let failed = 0;
  let passed = 0;
  for (const line of output.split("\n")) {
    let m = line.match(/(\d+)\s+pass/i);
    if (m) passed += Number(m[1]);
    m = line.match(/(\d+)\s+fail/i);
    if (m) failed += Number(m[1]);
  }
  return { failed, passed };
}

export interface ReportInput {
  readonly taskId: string;
  readonly commit: string;
  readonly checks: GateCheck[];
  readonly budget: BudgetState;
  readonly startedAt?: string;
}

/** Assemble a GateReport in the SDK-owned shape; throws when malformed. */
export function buildGateReport(input: ReportInput): GateReport {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const failed = input.checks.some((c) => c.exit !== 0);
  const overBudget = input.budget.diffLines > input.budget.limit;
  const timedOut = input.checks.some((c) => c.timedOut);
  const report = {
    taskId: input.taskId,
    commit: input.commit,
    runnerVersion: GATE_RUNNER_VERSION,
    startedAt,
    durationMs: input.checks.reduce((n, c) => n + c.durationMs, 0),
    verdict: (timedOut ? "timeout" : failed || overBudget ? "fail" : "pass") as GateReport["verdict"],
    checks: input.checks.map((c) => ({ id: c.id, exit: c.exit, durationMs: c.durationMs, outputHash: c.outputHash })),
    budget: { diffLines: input.budget.diffLines, limit: input.budget.limit },
  };
  const parsed = GateReportSchema.safeParse(report);
  if (!parsed.success) throw new Error(`built invalid GateReport: ${parsed.error.message}`);
  return parsed.data;
}
