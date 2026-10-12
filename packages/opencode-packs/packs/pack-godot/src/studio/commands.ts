// Studio slash commands (zero @opencode/* imports).
// Structural `ctx.command.transform()`-compatible: pass
// `registerStudioCommands` (or each definition's shape) as the transform
// callback. Executors accept injectable deps so tests run against mocks.

import { aggregateGateVerdicts, parseGateVerdict } from "./gates";
import type { GateVerdict } from "./gates";

export type StudioCommandName =
  | "setup-godot"
  | "adr"
  | "dev-story"
  | "story-done"
  | "gate-check";

export interface StudioCommandInput {
  readonly args?: readonly string[];
  readonly storyId?: string;
  readonly sessionID?: string;
  readonly prompt?: string;
}

export interface StudioCommandResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly details?: unknown;
}

// Minimal structural editor mirroring CommandEditor#add. Defined locally.
export interface StudioCommandEditor {
  readonly add: (definition: StudioCommandDefinition) => void;
}

export interface StudioCommandDefinition {
  readonly name: StudioCommandName;
  readonly description: string;
  readonly execute: (
    input: StudioCommandInput,
    deps?: StudioCommandDeps,
  ) => Promise<StudioCommandResult>;
}

export interface StudioCommandDeps {
  readonly checkEngine?: () => Promise<{ ok: boolean; version?: string }>;
  readonly loadStory?: (id: string) => Promise<unknown>;
  readonly spawnSpecialist?: (story: unknown) => Promise<unknown>;
  readonly runGut?: (work: unknown) => Promise<{
    passed: boolean;
    failures?: readonly string[];
  }>;
  readonly runHeadlessCheck?: (work: unknown) => Promise<{ passed: boolean }>;
  readonly commit?: (work: unknown) => Promise<{ sha: string }>;
  readonly runPhase?: (
    phase: string,
    input: unknown,
  ) => Promise<{
    phase: string;
    passed: boolean;
    notes?: string;
  }>;
  readonly runGates?: (
    input: unknown,
  ) => Promise<readonly string[] | readonly GateVerdict[]>;
}

export const DEV_STORY_STEPS = [
  "load-story",
  "spawn-specialist",
  "gut-test",
  "headless-check",
  "commit",
] as const;

export type DevStoryStep = (typeof DEV_STORY_STEPS)[number];

export interface DevStoryStepResult {
  readonly step: DevStoryStep;
  readonly ok: boolean;
  readonly detail?: unknown;
}

export interface DevStoryResult extends StudioCommandResult {
  readonly steps: readonly DevStoryStepResult[];
}

export const STORY_DONE_PHASES = [
  "scope",
  "implementation",
  "tests",
  "coverage",
  "headless",
  "scene",
  "gates",
  "docs",
] as const;

export type StoryDonePhase = (typeof STORY_DONE_PHASES)[number];

export interface StoryDonePhaseResult {
  readonly phase: StoryDonePhase;
  readonly passed: boolean;
  readonly notes?: string;
}

export interface StoryDoneResult extends StudioCommandResult {
  readonly phases: readonly StoryDonePhaseResult[];
}

export interface GateCheckResult extends StudioCommandResult {
  readonly verdict: GateVerdict;
  readonly outputs?: readonly string[];
}

export async function runSetupGodot(
  input: StudioCommandInput = {},
  deps: StudioCommandDeps = {},
): Promise<StudioCommandResult> {
  const check = deps.checkEngine ?? (async () => ({ ok: true as boolean }));
  const res = await check();
  if (!res.ok) {
    return {
      ok: false,
      summary: "setup-godot: engine check failed",
      details: res,
    };
  }
  void input;
  const version =
    "version" in res && typeof res.version === "string"
      ? (res.version as string)
      : undefined;
  return {
    ok: true,
    summary: `setup-godot: ready${version ? ` (Godot ${version})` : ""}`,
    details: res,
  };
}

export async function runAdr(
  input: StudioCommandInput = {},
  _deps: StudioCommandDeps = {},
): Promise<StudioCommandResult> {
  const title = input.args?.[0] ?? input.prompt ?? "untitled-decision";
  return { ok: true, summary: `adr: drafted ${title}`, details: { title } };
}

export async function runDevStory(
  input: StudioCommandInput,
  deps: StudioCommandDeps,
): Promise<DevStoryResult> {
  const storyId = input.storyId ?? input.args?.[0] ?? "S-unknown";
  const steps: DevStoryStepResult[] = [];
  const fail = (step: DevStoryStep, detail?: unknown): DevStoryResult => ({
    ok: false,
    summary: `dev-story ${storyId}: failed at ${step}`,
    steps: [...steps, { step, ok: false, detail }],
  });

  const load = deps.loadStory ?? (async (id: string) => ({ id }));
  const spawn = deps.spawnSpecialist ?? (async (s: unknown) => s);
  const gut = deps.runGut ?? (async () => ({ passed: true }));
  const headless = deps.runHeadlessCheck ?? (async () => ({ passed: true }));
  const commit = deps.commit ?? (async () => ({ sha: "mock" }));

  let story: unknown;
  try {
    story = await load(storyId);
  } catch (err) {
    return fail("load-story", err);
  }
  steps.push({ step: "load-story", ok: true, detail: story });

  let work: unknown;
  try {
    work = await spawn(story);
  } catch (err) {
    return fail("spawn-specialist", err);
  }
  steps.push({ step: "spawn-specialist", ok: true, detail: work });

  const gutRes = await gut(work);
  steps.push({ step: "gut-test", ok: gutRes.passed, detail: gutRes });
  if (!gutRes.passed) {
    return {
      ok: false,
      summary: `dev-story ${storyId}: failed at gut-test`,
      steps,
    };
  }

  const headRes = await headless(work);
  steps.push({ step: "headless-check", ok: headRes.passed, detail: headRes });
  if (!headRes.passed) {
    return {
      ok: false,
      summary: `dev-story ${storyId}: failed at headless-check`,
      steps,
    };
  }

  try {
    const c = await commit(work);
    steps.push({ step: "commit", ok: true, detail: c });
  } catch (err) {
    return fail("commit", err);
  }
  return {
    ok: true,
    summary: `dev-story ${storyId}: implemented, tested, committed`,
    steps,
  };
}

export async function runStoryDone(
  input: StudioCommandInput,
  deps: StudioCommandDeps,
): Promise<StoryDoneResult> {
  const storyId = input.storyId ?? input.args?.[0] ?? "S-unknown";
  const runPhase =
    deps.runPhase ??
    (async (phase: string) => ({ phase, passed: true as boolean }));
  const phases: StoryDonePhaseResult[] = [];
  for (const phase of STORY_DONE_PHASES) {
    const r = await runPhase(phase, { storyId });
    phases.push({
      phase,
      passed: r.passed,
      notes: "notes" in r ? (r.notes as string | undefined) : undefined,
    });
    if (!r.passed) {
      return {
        ok: false,
        summary: `story-done ${storyId}: phase ${phase} failed`,
        phases,
      };
    }
  }
  return { ok: true, summary: `story-done ${storyId}: accepted`, phases };
}

function toVerdictStrings(raw: readonly string[] | readonly GateVerdict[]): {
  verdicts: GateVerdict[];
  outputs?: string[];
} {
  if (raw.length === 0) return { verdicts: [] };
  if (
    raw.every(
      (r) =>
        r === "APPROVE" ||
        r === "CONCERNS" ||
        r === "REJECT" ||
        r === "NOT ASSESSED",
    )
  ) {
    return { verdicts: [...(raw as readonly GateVerdict[])] };
  }
  const outputs = [...(raw as readonly string[])];
  return { verdicts: outputs.map((o) => parseGateVerdict(o).verdict), outputs };
}

export async function runGateCheck(
  input: StudioCommandInput = {},
  deps: StudioCommandDeps = {},
): Promise<GateCheckResult> {
  const runGates = deps.runGates ?? (async () => [] as string[]);
  const raw = await runGates(input);
  const { verdicts, outputs } = toVerdictStrings(raw);
  const verdict = aggregateGateVerdicts(verdicts);
  return {
    ok: verdict !== "REJECT",
    summary: `gate-check: ${verdict}`,
    verdict,
    details: { verdicts },
    ...(outputs ? { outputs } : {}),
  };
}

const COMMAND_MAP: Record<
  StudioCommandName,
  (
    input: StudioCommandInput,
    deps?: StudioCommandDeps,
  ) => Promise<StudioCommandResult>
> = {
  "setup-godot": runSetupGodot,
  adr: runAdr,
  "dev-story": (input, deps = {}) => runDevStory(input, deps),
  "story-done": (input, deps = {}) => runStoryDone(input, deps),
  "gate-check": runGateCheck,
};

export function isStudioCommandName(name: string): name is StudioCommandName {
  return name in COMMAND_MAP;
}

export async function executeStudioCommand(
  name: string,
  input: StudioCommandInput = {},
  deps: StudioCommandDeps = {},
): Promise<StudioCommandResult> {
  if (!isStudioCommandName(name)) {
    throw new Error(`unknown studio command: ${name}`);
  }
  return COMMAND_MAP[name](input, deps);
}

export const STUDIO_COMMANDS: readonly StudioCommandDefinition[] = [
  {
    name: "setup-godot",
    description: "Verify Godot engine, project scaffold, bridge health.",
    execute: (input, deps) => executeStudioCommand("setup-godot", input, deps),
  },
  {
    name: "adr",
    description: "Draft an architecture decision record for TD-ADR review.",
    execute: (input, deps) => executeStudioCommand("adr", input, deps),
  },
  {
    name: "dev-story",
    description:
      "Load story, spawn specialist, GUT test, headless check, commit.",
    execute: (input, deps) => executeStudioCommand("dev-story", input, deps),
  },
  {
    name: "story-done",
    description: "8-phase acceptance audit before story close.",
    execute: (input, deps) => executeStudioCommand("story-done", input, deps),
  },
  {
    name: "gate-check",
    description: "Run director gates and aggregate verdicts.",
    execute: (input, deps) => executeStudioCommand("gate-check", input, deps),
  },
];

export function registerStudioCommands(editor: StudioCommandEditor): void {
  for (const def of STUDIO_COMMANDS) editor.add(def);
}
