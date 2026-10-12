import { describe, expect, test } from "bun:test";
import {
  CriterionSchema,
  DiffBudgetSchema,
  GateReportSchema,
  JudgeReportSchema,
  JournalEntrySchema,
  LaneSchema,
  GateCheckSchema,
  GatesConfigSchema,
  MCPToolDefSchema,
  MCPToolResultSchema,
  MissionSchema,
  PackManifestSchema,
  ReadinessResultSchema,
  TaskSchema,
} from "../src/contracts.js";

describe("seed schemas (backwards-compatible)", () => {
  test("Criterion round-trip", () => {
    const c = { id: "c1", text: "works", verify: "cmd", status: "unmet" } as const;
    expect(CriterionSchema.parse(c)).toEqual(c);
  });
  test("Task round-trip", () => {
    const t = {
      id: "t1", missionId: "m1", stage: "build", state: "pending",
      deps: [], lane: "docker", branch: "fleet/t1", attempts: 0,
      budget: { maxDiffLines: 800, maxDurationMinutes: 30 },
    };
    expect(TaskSchema.parse(t)).toMatchObject({ id: "t1" });
  });
  test("Mission round-trip", () => {
    const m = { id: "m1", intent: "do", acceptance: [], state: "active" };
    expect(MissionSchema.parse(m)).toMatchObject({ id: "m1" });
  });
  test("legacy GateReport (no artifacts/timedOut) still parses", () => {
    const legacy = {
      taskId: "t-014", commit: "9f3c1ab", runnerVersion: "1.2.0",
      startedAt: "2026-10-12T00:00:00Z", durationMs: 100, verdict: "pass",
      checks: [{ id: "lint", exit: 0, durationMs: 10, outputHash: "sha256:x" }],
      budget: { diffLines: 214, limit: 800 },
    };
    const parsed = GateReportSchema.parse(legacy);
    expect(parsed.artifacts).toEqual([]);
    expect(parsed.checks[0]?.timedOut).toBe(false);
  });
  test("MCPToolDef round-trip", () => {
    expect(MCPToolDefSchema.parse({ name: "n", description: "d", inputSchema: {} })).toMatchObject({ name: "n" });
  });
});

describe("new schemas", () => {
  test("Lane round-trip", () => {
    const l = { id: "l1", tier: "docker" as const, image: "lane-base:1", mounts: [] as string[], network: "gateway-only" as const };
    expect(LaneSchema.parse(l)).toEqual(l);
  });
  test("GateCheck defaults", () => {
    const g = GateCheckSchema.parse({ id: "lint", kind: "lint", cmd: "true" });
    expect(g.timeoutSeconds).toBe(300);
  });
  test("GatesConfig parses canonical gates.yaml subset", () => {
    const cfg = GatesConfigSchema.parse({
      version: 1,
      gates: [{ id: "budget", kind: "budget", maxDiffLines: 800 }],
    });
    expect(cfg.gates).toHaveLength(1);
  });
  test("DiffBudget round-trip", () => {
    expect(DiffBudgetSchema.parse({ diffLines: 1, limit: 2 })).toEqual({ diffLines: 1, limit: 2 });
  });
  test("MCPToolResult round-trip", () => {
    const r = { tool: "search", content: "x", contentHash: "sha256:y" };
    expect(MCPToolResultSchema.parse(r)).toMatchObject({ tool: "search" });
  });
  test("PackManifest defaults", () => {
    const p = PackManifestSchema.parse({ id: "godot", version: "1.0.0", hostCompat: "2.0.x" });
    expect(p.laneRequires).toEqual([]);
    expect(p.tools).toEqual([]);
  });
  test("ReadinessResult round-trip", () => {
    expect(ReadinessResultSchema.parse({ packId: "godot", status: "degraded", reason: "no binary" }).status).toBe("degraded");
  });
  test("JudgeReport confidence bounds enforced", () => {
    expect(() => JudgeReportSchema.parse({ seat: "qa-functional", verdict: "pass", confidence: 2 })).toThrow();
    expect(JudgeReportSchema.parse({ seat: "qa-adversarial", verdict: "fail", confidence: 0.5 }).verdict).toBe("fail");
  });
  test("JournalEntry round-trip", () => {
    const e = { seq: 0, at: "t", actor: "op", event: "start", prevHash: "genesis", hash: "h" };
    expect(JournalEntrySchema.parse(e)).toEqual(e);
  });
});
