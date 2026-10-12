/**
 * goalUnchanged: heuristic guard that build agents do not silently mutate
 * the mission spec or acceptance criteria during execution.
 *
 * Compares the initial grill output against current context:
 *  - intent: normalized text must match, or share enough token overlap
 *  - criteria: every initial criterion must still be present (by id, or by
 *    normalized-text / token overlap) and none may be weakened to a
 *    less strict verify method without a human waiver.
 *
 * Returns true when the goal is unchanged. Use checkGoalDrift for reasons.
 */

export interface GoalCriterion {
  readonly id: string;
  readonly text: string;
  /** How the criterion is verified: cmd < judge < human (strictness order). */
  readonly verify?: string;
}

export interface GoalSnapshot {
  readonly intent: string;
  readonly criteria: GoalCriterion[];
}

export interface DriftReport {
  readonly unchanged: boolean;
  readonly reasons: string[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "is", "are", "be", "must", "should",
  "that", "this", "it", "as", "at",
]);

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function contentTokens(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

/** Jaccard overlap of content tokens, 0..1. */
export function tokenOverlap(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return normalizeText(a) === normalizeText(b) ? 1 : 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const INTENT_OVERLAP_FLOOR = 0.55;
const CRITERION_OVERLAP_FLOOR = 0.6;

/** Strictness rank: cmd (mechanical) > judge (model) > human (manual). */
function strictness(verify?: string): number {
  switch ((verify ?? "").toLowerCase()) {
    case "cmd":
      return 3;
    case "judge":
      return 2;
    case "human":
      return 1;
    default:
      return 0;
  }
}

function matchCriterion(initial: GoalCriterion, current: GoalCriterion[]): GoalCriterion | undefined {
  const byId = current.find((c) => c.id === initial.id);
  if (byId) return byId;
  let best: GoalCriterion | undefined;
  let bestScore = 0;
  for (const c of current) {
    if (normalizeText(c.text) === normalizeText(initial.text)) return c;
    const score = tokenOverlap(c.text, initial.text);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= CRITERION_OVERLAP_FLOOR ? best : undefined;
}

export function checkGoalDrift(initial: GoalSnapshot, current: GoalSnapshot): DriftReport {
  const reasons: string[] = [];

  const normInitial = normalizeText(initial.intent);
  const normCurrent = normalizeText(current.intent);
  if (normInitial !== normCurrent) {
    const overlap = tokenOverlap(initial.intent, current.intent);
    if (overlap < INTENT_OVERLAP_FLOOR) {
      reasons.push(`intent changed (token overlap ${overlap.toFixed(2)} < ${INTENT_OVERLAP_FLOOR})`);
    }
  }

  for (const c of initial.criteria) {
    const match = matchCriterion(c, [...current.criteria]);
    if (!match) {
      reasons.push(`criterion ${JSON.stringify(c.id)} removed or rewritten`);
      continue;
    }
    if (c.verify && match.verify && strictness(match.verify) < strictness(c.verify)) {
      reasons.push(
        `criterion ${JSON.stringify(c.id)} weakened: verify ${JSON.stringify(c.verify)} -> ${JSON.stringify(match.verify)}`,
      );
    }
  }

  const initialIds = new Set(initial.criteria.map((c) => c.id));
  for (const c of current.criteria) {
    if (!initialIds.has(c.id) && !matchCriterion(c, [...initial.criteria])) {
      reasons.push(`criterion ${JSON.stringify(c.id)} added without grill round (scope creep)`);
    }
  }

  return { unchanged: reasons.length === 0, reasons };
}

/** Boolean heuristic: true when the executing context still honors the initial goal. */
export function goalUnchanged(initial: GoalSnapshot, current: GoalSnapshot): boolean {
  return checkGoalDrift(initial, current).unchanged;
}
