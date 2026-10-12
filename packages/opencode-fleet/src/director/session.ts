/**
 * Director planning interface: mission grilling and acceptance criteria.
 * Pure functions only — no I/O — so grill.test can run deterministically.
 */

export interface GrillingQuestion {
  id: string;
  question: string;
  severity: "minor" | "major" | "blocking";
}

export interface MissionBrief {
  title: string;
  intent: string;
  acceptance: { id: string; text: string; verify: "cmd" | "judge" | "human"; command?: string }[];
  openQuestions: GrillingQuestion[];
}

const VERB_RE = /\b(build|create|implement|add|fix|migrate|refactor|ship|deploy|design|write|test|document|support|enable|remove|update|upgrade|automate|integrate)\w*\b/i;

/**
 * Rule-based grilling heuristics (deterministic, documented):
 *  - intent shorter than 20 chars -> blocking (too vague to plan from).
 *  - no verb-like action word -> major (unclear what to do).
 *  - no sentence-ending punctuation or single sentence -> minor (ask for scope/acceptance detail).
 *  - mentions production/deploy/release/migration without rollback/verify words -> major (risk question).
 */
export function grillMission(intent: string): GrillingQuestion[] {
  const questions: GrillingQuestion[] = [];
  const trimmed = intent.trim();
  if (trimmed.length < 20) {
    questions.push({
      id: "q-vague",
      question: "The mission intent is too short to plan from. What exactly should be built, for whom, and what does done look like?",
      severity: "blocking",
    });
    return questions;
  }
  if (!VERB_RE.test(trimmed)) {
    questions.push({
      id: "q-action",
      question: "No clear action verb found. What should the fleet build, change, or deliver?",
      severity: "major",
    });
  }
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    questions.push({
      id: "q-scope",
      question: "Only one sentence of intent. What is in scope vs out of scope, and what are the acceptance criteria?",
      severity: "minor",
    });
  }
  if (/\b(production|deploy|release|migrat\w*)\b/i.test(trimmed) && !/\b(rollback|verif\w*|canary|dry-?run|backup)\b/i.test(trimmed)) {
    questions.push({
      id: "q-risk",
      question: "This touches production/data. What is the rollback or verification plan?",
      severity: "major",
    });
  }
  return questions;
}

/** Split the intent into at most 3 acceptance criteria (verify: judge default). */
export function buildAcceptanceCriteria(intent: string): MissionBrief["acceptance"] {
  const sentences = intent
    .trim()
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean)
    .slice(0, 3);
  const source = sentences.length > 0 ? sentences : [intent.trim() || "Mission intent"];
  return source.map((text, i) => ({ id: `ac-${i + 1}`, text, verify: "judge" as const }));
}

/** Render a mission brief as a markdown mission.md body. */
export function renderMissionBrief(b: MissionBrief): string {
  const lines: string[] = [`# ${b.title}`, "", "## Intent", "", b.intent, "", "## Acceptance", ""];
  for (const ac of b.acceptance) {
    lines.push(`- [ ] ${ac.id}: ${ac.text} (verify: ${ac.verify})`);
  }
  lines.push("", "## Open questions", "");
  if (b.openQuestions.length === 0) {
    lines.push("None.");
  } else {
    for (const q of b.openQuestions) {
      lines.push(`- [${q.severity}] ${q.id}: ${q.question}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** A mission is finalizable when no blocking or major questions remain open. */
export function finalizeMission(b: MissionBrief): { ok: boolean; blocking: GrillingQuestion[] } {
  const blocking = b.openQuestions.filter((q) => q.severity === "blocking" || q.severity === "major");
  return { ok: blocking.length === 0, blocking };
}
