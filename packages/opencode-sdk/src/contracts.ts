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
  })),
  budget: z.object({ diffLines: z.number(), limit: z.number() }),
});

export const MCPToolDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.any()),
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type GateReport = z.infer<typeof GateReportSchema>;
export type MCPToolDef = z.infer<typeof MCPToolDefSchema>;
