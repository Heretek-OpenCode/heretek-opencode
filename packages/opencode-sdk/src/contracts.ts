import { z } from "zod";

export const CriterionSchema = z.object({
  id: z.string(),
  text: z.string(),
  verify: z.enum(["cmd", "judge", "human"]),
  status: z.enum(["unmet", "met", "waived_by_human"]),
});

export const TaskSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  stage: z.enum(["grill", "research", "spec", "build", "qa_functional", "qa_adversarial", "human_pr"]),
  state: z.enum(["pending", "ready", "running", "waiting_human", "done", "failed", "cancelled"]),
  deps: z.array(z.string()),
  lane: z.enum(["bwrap", "docker", "dagger"]),
  branch: z.string(),
  attempts: z.number().default(0),
  budget: z.object({ maxDiffLines: z.number(), maxDurationMinutes: z.number() }),
});

export const MissionSchema = z.object({
  id: z.string(),
  intent: z.string(),
  acceptance: z.array(CriterionSchema),
  state: z.enum(["pending", "active", "blocked", "done", "failed", "cancelled"]),
});

export const GateReportSchema = z.object({
  taskId: z.string(),
  commit: z.string(),
  runnerVersion: z.string(),
  startedAt: z.string(),
  durationMs: z.number(),
  verdict: z.enum(["pass", "fail", "timeout"]),
  checks: z.array(z.object({
    id: z.string(),
    exit: z.number(),
    durationMs: z.number(),
    outputHash: z.string(),
    timedOut: z.boolean().default(false),
  })),
  budget: z.object({ diffLines: z.number(), limit: z.number() }),
  artifacts: z.array(z.object({
    path: z.string(),
    sha256: z.string(),
  })).default([]),
});

export const MCPToolDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.any()),
});

// --- additions (blueprint §5.1.1, §5.1.3) ---

export const LaneSchema = z.object({
  id: z.string(),
  tier: z.enum(["bwrap", "docker", "dagger"]),
  image: z.string(),
  mounts: z.array(z.string()).default([]),
  network: z.enum(["none", "gateway-only"]),
});

export const GateCheckSchema = z.object({
  id: z.string(),
  kind: z.enum(["lint", "typecheck", "tests-changed", "security", "budget", "custom"]),
  cmd: z.string().optional(),
  timeoutSeconds: z.number().default(300),
  cacheKey: z.string().optional(),
  maxDiffLines: z.number().optional(),
});

export const GatesConfigSchema = z.object({
  version: z.literal(1),
  gates: z.array(GateCheckSchema),
});

export const DiffBudgetSchema = z.object({
  diffLines: z.number(),
  limit: z.number(),
});

export const MCPToolResultSchema = z.object({
  tool: z.string(),
  content: z.string(),
  structuredContent: z.record(z.any()).optional(),
  contentHash: z.string(),
  error: z.string().optional(),
});

export const PackManifestSchema = z.object({
  id: z.string(),
  version: z.string(),
  hostCompat: z.string(),
  laneRequires: z.array(z.object({
    capability: z.string(),
    image: z.string(),
  })).default([]),
  tools: z.array(z.object({
    server: z.string(),
    transport: z.enum(["stdio", "http"]).default("stdio"),
  })).default([]),
  agents: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  commands: z.array(z.object({
    name: z.string(),
    handler: z.string(),
  })).default([]),
});

export const ReadinessResultSchema = z.object({
  packId: z.string(),
  status: z.enum(["ready", "degraded"]),
  reason: z.string().optional(),
});

export const JudgeReportSchema = z.object({
  seat: z.enum(["qa-functional", "qa-adversarial"]),
  verdict: z.enum(["pass", "fail"]),
  criteria: z.array(z.object({
    id: z.string(),
    pass: z.boolean(),
    evidence: z.string(),
  })).default([]),
  findings: z.array(z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    summary: z.string(),
    reproduction: z.string(),
  })).default([]),
  evidence: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export const JournalEntrySchema = z.object({
  seq: z.number(),
  at: z.string(),
  actor: z.string(),
  event: z.string(),
  prevHash: z.string(),
  hash: z.string(),
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type GateReport = z.infer<typeof GateReportSchema>;
export type MCPToolDef = z.infer<typeof MCPToolDefSchema>;
export type Lane = z.infer<typeof LaneSchema>;
export type GateCheck = z.infer<typeof GateCheckSchema>;
export type GatesConfig = z.infer<typeof GatesConfigSchema>;
export type DiffBudget = z.infer<typeof DiffBudgetSchema>;
export type MCPToolResult = z.infer<typeof MCPToolResultSchema>;
export type PackManifest = z.infer<typeof PackManifestSchema>;
export type ReadinessResult = z.infer<typeof ReadinessResultSchema>;
export type JudgeReport = z.infer<typeof JudgeReportSchema>;
export type JournalEntry = z.infer<typeof JournalEntrySchema>;
