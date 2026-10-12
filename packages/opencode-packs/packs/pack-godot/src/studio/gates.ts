// Director gate protocol: 26 deterministic gates.
// Verdict line 1: `[GATE-ID]: APPROVE|CONCERNS|REJECT|NOT ASSESSED`
// followed by criteria/rationale lines. Precedence for aggregation:
// REJECT > CONCERNS > NOT ASSESSED > APPROVE.

export type GateVerdict = "APPROVE" | "CONCERNS" | "REJECT" | "NOT ASSESSED";

export const GATE_IDS = [
  "CD-PILLARS",
  "CD-GDD-ALIGN",
  "CD-SYSTEMS",
  "CD-NARRATIVE",
  "CD-PLAYTEST",
  "CD-PHASE-GATE",
  "TD-SYSTEM-BOUNDARY",
  "TD-FEASIBILITY",
  "TD-ARCHITECTURE",
  "TD-ADR",
  "TD-ENGINE-RISK",
  "TD-PHASE-GATE",
  "TD-MANIFEST",
  "TD-CHANGE-IMPACT",
  "PR-SCOPE",
  "PR-SPRINT",
  "PR-MILESTONE",
  "PR-EPIC",
  "PR-PHASE-GATE",
  "AD-CONCEPT-VISUAL",
  "AD-ART-BIBLE",
  "AD-PHASE-GATE",
  "LP-FEASIBILITY",
  "LP-CODE-REVIEW",
  "QL-STORY-READY",
  "QL-TEST-COVERAGE",
] as const;

export type GateId = (typeof GATE_IDS)[number];

export interface GateDefinition {
  readonly id: GateId;
  readonly owner: string;
  readonly purpose: string;
  readonly criteria: readonly string[];
}

function def(
  id: GateId,
  owner: string,
  purpose: string,
  criteria: readonly string[] = ["all inputs present", "no blocking issues"],
): GateDefinition {
  return { id, owner, purpose, criteria };
}

export const GATE_DEFINITIONS: Record<GateId, GateDefinition> = {
  "CD-PILLARS": def("CD-PILLARS", "creative-director", "Pillar stress test", [
    "pillars defined",
    "pillars distinguish game",
    "no pillar conflicts",
  ]),
  "CD-GDD-ALIGN": def(
    "CD-GDD-ALIGN",
    "creative-director",
    "GDD pillar alignment",
    ["system GDD references pillars", "deviations justified"],
  ),
  "CD-SYSTEMS": def(
    "CD-SYSTEMS",
    "creative-director",
    "Systems decomposition vision check",
    ["systems cover pillars", "no vision drift"],
  ),
  "CD-NARRATIVE": def(
    "CD-NARRATIVE",
    "creative-director",
    "Narrative consistency of story/lore",
    ["lore consistent", "tone matches pillars"],
  ),
  "CD-PLAYTEST": def(
    "CD-PLAYTEST",
    "creative-director",
    "Player experience validation",
    ["playtest report present", "experience matches intent"],
  ),
  "CD-PHASE-GATE": def(
    "CD-PHASE-GATE",
    "creative-director",
    "Creative readiness at phase transition",
    ["phase artifacts present", "creative sign-off"],
  ),
  "TD-SYSTEM-BOUNDARY": def(
    "TD-SYSTEM-BOUNDARY",
    "technical-director",
    "System boundary review",
    ["boundaries defined", "interfaces minimal"],
  ),
  "TD-FEASIBILITY": def(
    "TD-FEASIBILITY",
    "technical-director",
    "Technical feasibility of concept risks",
    ["risks enumerated", "mitigations plausible"],
  ),
  "TD-ARCHITECTURE": def(
    "TD-ARCHITECTURE",
    "technical-director",
    "Master architecture sign-off",
    ["architecture doc present", "Godot 4idioms", "no cross-system conflicts"],
  ),
  "TD-ADR": def("TD-ADR", "technical-director", "ADR review", [
    "ADR states context/decision/consequences",
    "alternatives considered",
  ]),
  "TD-ENGINE-RISK": def(
    "TD-ENGINE-RISK",
    "technical-director",
    "Engine version risk",
    ["API availability in engine version", "fallback documented"],
  ),
  "TD-PHASE-GATE": def(
    "TD-PHASE-GATE",
    "technical-director",
    "Technical readiness at phase transition",
    ["artifacts present", "headless checks pass"],
  ),
  "TD-MANIFEST": def(
    "TD-MANIFEST",
    "technical-director",
    "Control manifest review",
    ["manifest lists inputs", "bindings conflict-free"],
  ),
  "TD-CHANGE-IMPACT": def(
    "TD-CHANGE-IMPACT",
    "technical-director",
    "Design-change impact assessment",
    ["impact scoped", "dependents notified"],
  ),
  "PR-SCOPE": def("PR-SCOPE", "producer", "Scope and timeline validation", [
    "scope bounded",
    "timeline feasible",
  ]),
  "PR-SPRINT": def("PR-SPRINT", "producer", "Sprint plan feasibility", [
    "stories sized",
    "capacity respected",
  ]),
  "PR-MILESTONE": def("PR-MILESTONE", "producer", "Milestone risk", [
    "risks tracked",
    "critical path clear",
  ]),
  "PR-EPIC": def("PR-EPIC", "producer", "Epic structure feasibility", [
    "epics slice value",
    "story breakdown ready",
  ]),
  "PR-PHASE-GATE": def("PR-PHASE-GATE", "producer", "Production readiness", [
    "plan current",
    "risks accepted",
  ]),
  "AD-CONCEPT-VISUAL": def(
    "AD-CONCEPT-VISUAL",
    "art-director",
    "Visual identity anchor",
    ["pillars locked", "identity distinct"],
  ),
  "AD-ART-BIBLE": def("AD-ART-BIBLE", "art-director", "Art bible sign-off", [
    "bible complete",
    "pipeline feasible",
  ]),
  "AD-PHASE-GATE": def("AD-PHASE-GATE", "art-director", "Visual readiness", [
    "artifacts present",
    "visual sign-off",
  ]),
  "LP-FEASIBILITY": def(
    "LP-FEASIBILITY",
    "lead-programmer",
    "Implementation feasibility",
    ["architecture implementable", "estimates bounded"],
  ),
  "LP-CODE-REVIEW": def("LP-CODE-REVIEW", "lead-programmer", "Code review", [
    "standards met",
    "tests present",
    "no tech-debt growth",
  ]),
  "QL-STORY-READY": def("QL-STORY-READY", "qa-lead", "Acceptance testability", [
    "criteria testable",
    "GUT approach clear",
  ]),
  "QL-TEST-COVERAGE": def(
    "QL-TEST-COVERAGE",
    "qa-lead",
    "Test coverage for story close",
    ["GUT tests pass", "headless checks pass", "coverage documented"],
  ),
};

const GATE_SET = new Set<string>(GATE_IDS);

export function isGateId(id: string): id is GateId {
  return GATE_SET.has(id);
}

export function requireGate(id: string): GateDefinition {
  if (!isGateId(id)) throw new Error(`unknown gate: ${id}`);
  return GATE_DEFINITIONS[id];
}

export interface ParsedGateVerdict {
  readonly gateId: GateId;
  readonly verdict: GateVerdict;
  readonly criteria: string;
}

const FIRST_LINE_RE =
  /^\[([A-Z0-9][A-Z0-9-]*)\]:\s(APPROVE|CONCERNS|REJECT|NOT ASSESSED)\s*$/;

export function parseGateVerdict(output: string): ParsedGateVerdict {
  if (!output || !output.trim()) throw new Error("empty gate verdict");
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  const match = FIRST_LINE_RE.exec(first);
  if (!match) throw new Error(`malformed gate verdict line 1: ${first}`);
  const gateId = match[1] as string;
  const verdict = match[2] as GateVerdict;
  if (!isGateId(gateId)) throw new Error(`unknown gate: ${gateId}`);
  const criteria = lines.slice(1).join("\n").trim();
  return { gateId, verdict, criteria };
}

export function formatGateVerdict(
  gateId: GateId,
  verdict: GateVerdict,
  criteria = "",
): string {
  requireGate(gateId);
  return criteria
    ? `[${gateId}]: ${verdict}\n${criteria}`
    : `[${gateId}]: ${verdict}`;
}

const PRECEDENCE: Record<GateVerdict, number> = {
  REJECT: 3,
  CONCERNS: 2,
  "NOT ASSESSED": 1,
  APPROVE: 0,
};

export function aggregateGateVerdicts(
  verdicts: readonly GateVerdict[],
): GateVerdict {
  let worst: GateVerdict = "APPROVE";
  let seen = false;
  for (const v of verdicts) {
    seen = true;
    if (!(v in PRECEDENCE)) throw new Error(`unknown verdict: ${v}`);
    if (PRECEDENCE[v] > PRECEDENCE[worst]) worst = v;
  }
  if (!seen) return "NOT ASSESSED";
  return worst;
}

export function aggregateGateOutputs(outputs: readonly string[]): GateVerdict {
  return aggregateGateVerdicts(outputs.map((o) => parseGateVerdict(o).verdict));
}
