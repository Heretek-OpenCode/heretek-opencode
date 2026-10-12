import { sha256Hex } from "../util/hash.js";

export type JudgeSeat = "qa-functional" | "qa-adversarial";
export type JudgeVerdict = "pass" | "fail";

export interface CriterionResult {
  readonly id: string;
  readonly status: "met" | "unmet";
  readonly evidence: string;
}

export interface AdversarialFinding {
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly title: string;
  readonly repro: string;
  readonly ref?: string;
}

export interface EvidenceItem {
  readonly kind: string;
  readonly detail: string;
  readonly exit?: number;
  readonly outputHash?: string;
}

export interface JudgeReport {
  readonly seat: JudgeSeat;
  readonly verdict: JudgeVerdict;
  readonly criteria?: CriterionResult[];
  readonly findings?: AdversarialFinding[];
  readonly evidence: EvidenceItem[];
  readonly confidence: number;
}

export class JudgeReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeReportError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function checkEvidence(list: unknown): EvidenceItem[] {
  if (!Array.isArray(list)) throw new JudgeReportError("evidence must be an array");
  return list.map((e, i) => {
    if (!isRecord(e) || typeof e.kind !== "string" || typeof e.detail !== "string") {
      throw new JudgeReportError(`evidence[${i}] needs kind + detail strings`);
    }
    const item: EvidenceItem = { kind: e.kind, detail: e.detail };
    if (typeof e.exit === "number") (item as { exit?: number }).exit = e.exit;
    if (typeof e.outputHash === "string") (item as { outputHash?: string }).outputHash = e.outputHash;
    return item;
  });
}

/** Parse and validate raw model output into judge-report.json shape. */
export function parseJudgeReport(raw: unknown): JudgeReport {
  const obj = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!isRecord(obj)) throw new JudgeReportError("report must be an object");
  if (obj.seat !== "qa-functional" && obj.seat !== "qa-adversarial") {
    throw new JudgeReportError(`unknown seat ${JSON.stringify(obj.seat)}`);
  }
  if (obj.verdict !== "pass" && obj.verdict !== "fail") {
    throw new JudgeReportError(`unknown verdict ${JSON.stringify(obj.verdict)}`);
  }
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    throw new JudgeReportError("confidence must be a number in 0..1");
  }
  const report: JudgeReport = {
    seat: obj.seat,
    verdict: obj.verdict,
    evidence: checkEvidence(obj.evidence),
    confidence: obj.confidence,
  };
  if (obj.seat === "qa-functional") {
    if (!Array.isArray(obj.criteria)) throw new JudgeReportError("qa-functional needs criteria[]");
    (report as { criteria?: CriterionResult[] }).criteria = obj.criteria.map((c, i) => {
      if (!isRecord(c) || typeof c.id !== "string" || typeof c.evidence !== "string") {
        throw new JudgeReportError(`criteria[${i}] needs id + evidence strings`);
      }
      if (c.status !== "met" && c.status !== "unmet") throw new JudgeReportError(`criteria[${i}] bad status`);
      return { id: c.id, status: c.status, evidence: c.evidence };
    });
    if (report.verdict === "pass" && report.criteria!.some((c) => c.status === "unmet")) {
      throw new JudgeReportError("verdict pass with unmet criteria");
    }
  } else {
    if (obj.findings !== undefined) {
      if (!Array.isArray(obj.findings)) throw new JudgeReportError("findings must be an array");
      (report as { findings?: AdversarialFinding[] }).findings = obj.findings.map((f, i) => {
        if (!isRecord(f) || typeof f.title !== "string" || typeof f.repro !== "string") {
          throw new JudgeReportError(`findings[${i}] needs title + repro strings`);
        }
        const sev = f.severity;
        if (sev !== "critical" && sev !== "high" && sev !== "medium" && sev !== "low" && sev !== "info") {
          throw new JudgeReportError(`findings[${i}] bad severity`);
        }
        const out: AdversarialFinding = { severity: sev, title: f.title, repro: f.repro };
        if (typeof f.ref === "string") (out as { ref?: string }).ref = f.ref;
        return out;
      });
    }
    const highs = (report.findings ?? []).filter((f) => f.severity === "critical" || f.severity === "high");
    if (report.verdict === "pass" && highs.length > 0) {
      throw new JudgeReportError("verdict pass with high+ findings");
    }
  }
  return report;
}

/** Judges disagree when verdicts differ — the scheduler mints a fix task. */
export function judgesDisagree(a: JudgeReport, b: JudgeReport): boolean {
  return a.verdict !== b.verdict;
}

/** High+ adversarial findings always require a fix task. */
export function needsFix(report: JudgeReport): boolean {
  if (report.seat === "qa-functional") {
    return report.verdict === "fail" || (report.criteria ?? []).some((c) => c.status === "unmet");
  }
  return (
    report.verdict === "fail" ||
    (report.findings ?? []).some((f) => f.severity === "critical" || f.severity === "high")
  );
}

/** Content hash of a report for journal evidence. */
export function reportHash(report: JudgeReport): string {
  return `sha256:${sha256Hex(JSON.stringify(report))}`;
}
