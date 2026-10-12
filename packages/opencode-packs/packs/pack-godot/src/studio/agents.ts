// Studio agent roster (zero @opencode/* imports).
// Structural `ctx.agent.transform()`-compatible definitions: pass
// `studioAgentTransform` (or `registerStudioAgents`) as the transform
// callback; the editor shape below is a structural subset of the real
// AgentEditor, with an optional `add` used when the host exposes one.

export type StudioAgentTier = "director" | "lead" | "specialist";
export type StudioModel = "opus" | "pro" | "sonnet";
export type PermissionAction = "allow" | "deny" | "ask";
export type PermissionTool = "shell" | "edit";

export interface StudioAgentPermissions {
  readonly shell: PermissionAction;
  readonly edit: PermissionAction;
}

export interface StudioAgentDefinition {
  readonly id: string;
  readonly tier: StudioAgentTier;
  readonly description: string;
  readonly model: StudioModel;
  readonly permissions: StudioAgentPermissions;
  readonly tools: readonly string[];
}

export type StudioAgentId =
  | "technical-director"
  | "creative-director"
  | "producer"
  | "lead-programmer"
  | "game-designer"
  | "qa-lead"
  | "godot-architect"
  | "godot-gdscript-specialist"
  | "godot-shader-specialist"
  | "godot-qa-tester";

const DIRECTOR_PERMISSIONS: StudioAgentPermissions = {
  shell: "deny",
  edit: "deny",
};
const LEAD_PERMISSIONS: StudioAgentPermissions = {
  shell: "deny",
  edit: "ask",
};
const SPECIALIST_PERMISSIONS: StudioAgentPermissions = {
  shell: "allow",
  edit: "allow",
};

export const STUDIO_AGENTS: readonly StudioAgentDefinition[] = [
  {
    id: "technical-director",
    tier: "director",
    description:
      "Technical vision, engine architecture, performance strategy, risk.",
    model: "opus",
    permissions: DIRECTOR_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "WebSearch"],
  },
  {
    id: "creative-director",
    tier: "director",
    description:
      "Creative authority: vision, tone, pillars, aesthetic direction.",
    model: "opus",
    permissions: DIRECTOR_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "WebSearch"],
  },
  {
    id: "producer",
    tier: "director",
    description: "Scope, schedule, milestones, sprint feasibility.",
    model: "pro",
    permissions: DIRECTOR_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "WebSearch"],
  },
  {
    id: "lead-programmer",
    tier: "lead",
    description: "Code architecture, standards, review, refactoring strategy.",
    model: "sonnet",
    permissions: LEAD_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
  },
  {
    id: "game-designer",
    tier: "lead",
    description: "Systems design, GDD authorship, balance, player experience.",
    model: "sonnet",
    permissions: LEAD_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
  },
  {
    id: "qa-lead",
    tier: "lead",
    description: "Acceptance criteria, test plans, coverage gates.",
    model: "sonnet",
    permissions: LEAD_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
  },
  {
    id: "godot-architect",
    tier: "specialist",
    description: "Godot 4 scene-tree architecture, autoloads, manifests.",
    model: "sonnet",
    permissions: SPECIALIST_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
  },
  {
    id: "godot-gdscript-specialist",
    tier: "specialist",
    description: "GDScript quality: typing, signals, idioms, performance.",
    model: "sonnet",
    permissions: SPECIALIST_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
  },
  {
    id: "godot-shader-specialist",
    tier: "specialist",
    description: "Godot shader language, visual effects, material pipelines.",
    model: "sonnet",
    permissions: SPECIALIST_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
  },
  {
    id: "godot-qa-tester",
    tier: "specialist",
    description: "GUT tests, headless checks, playtest harnesses.",
    model: "sonnet",
    permissions: SPECIALIST_PERMISSIONS,
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
  },
];

const BY_ID = new Map<string, StudioAgentDefinition>(
  STUDIO_AGENTS.map((a) => [a.id, a]),
);

export function isStudioAgentId(id: string): id is StudioAgentId {
  return BY_ID.has(id);
}

export function getStudioAgent(id: string): StudioAgentDefinition | undefined {
  return BY_ID.get(id);
}

export function requireStudioAgent(id: string): StudioAgentDefinition {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown studio agent: ${id}`);
  return def;
}

export function checkStudioPermission(
  id: string,
  tool: PermissionTool,
): PermissionAction {
  return requireStudioAgent(id).permissions[tool];
}

// Minimal structural editor: real AgentEditor subset (list/get/default/
// update/remove) plus optional add/register/set used when the host exposes
// agent creation. Defined locally; no @opencode/* import.
export interface StudioAgentEditor {
  readonly list?: () => readonly unknown[];
  readonly get?: (id: string) => unknown | undefined;
  readonly default?: (id: string | undefined) => void;
  readonly update?: (id: string, update: (agent: never) => void) => void;
  readonly remove?: (id: string) => void;
  readonly add?: (definition: StudioAgentDefinition) => void;
  readonly register?: (definition: StudioAgentDefinition) => void;
  readonly set?: (id: string, definition: StudioAgentDefinition) => void;
}

function insertInto(
  editor: StudioAgentEditor,
  def: StudioAgentDefinition,
): void {
  if (typeof editor.add === "function") {
    editor.add(def);
    return;
  }
  if (typeof editor.register === "function") {
    editor.register(def);
    return;
  }
  if (typeof editor.set === "function") {
    editor.set(def.id, def);
    return;
  }
  // Fallback for editors exposing only update(): attempt an upsert-shaped
  // call. Hosts that reject unknown ids will throw, surfacing loudly.
  if (typeof editor.update === "function") {
    editor.update(def.id, () => def as never);
    return;
  }
  throw new Error("studio agent editor exposes no add/register/update method");
}

export function registerStudioAgents(editor: StudioAgentEditor): void {
  for (const def of STUDIO_AGENTS) insertInto(editor, def);
}

// Direct `ctx.agent.transform()` callback: `ctx.agent.transform((e) =>
// studioAgentTransform(e))` or pass the reference through.
export function studioAgentTransform(editor: StudioAgentEditor): void {
  registerStudioAgents(editor);
}
