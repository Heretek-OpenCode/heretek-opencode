import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  emptyView,
  projectMissions,
  readyNodes,
  type FleetEvent,
} from "../src/projections/missions";
import { isStale, renderMissionCard, renderMissionSummary } from "../src/components/MissionViewer";

function ev(seq: number, type: FleetEvent["type"], payload: Record<string, unknown> = {}, missionId = "m-1"): FleetEvent {
  return { seq, at: `2026-10-12T00:00:${String(seq).padStart(2, "0")}Z`, type, missionId, payload };
}

describe("missions projection", () => {
  test("projects out-of-order events in seq order", () => {
    const vm = projectMissions([
      ev(3, "task.upsert", { id: "t-1", stage: "build", state: "done", deps: [] }),
      ev(1, "mission.created", { intent: "Add a healthcheck endpoint" }),
      ev(2, "mission.state", { state: "active" }),
    ]);
    expect(vm.missions).toHaveLength(1);
    expect(vm.missions[0].intent).toBe("Add a healthcheck endpoint");
    expect(vm.missions[0].state).toBe("active");
    expect(vm.dagNodes).toHaveLength(1);
  });

  test("task.state upserts; lane/gate/judge events fold", () => {
    let vm = emptyView();
    vm = applyEvent(vm, ev(1, "mission.created", { intent: "x" }));
    vm = applyEvent(vm, ev(2, "task.upsert", { id: "t-1", stage: "build", state: "running", deps: [] }));
    vm = applyEvent(vm, ev(3, "task.state", { id: "t-1", stage: "build", state: "done", deps: [] }));
    vm = applyEvent(vm, ev(4, "lane.status", { id: "lane-1", tier: "docker", status: "idle", taskId: "t-1" }));
    vm = applyEvent(vm, ev(5, "gate.report", { taskId: "t-1", verdict: "pass", checks: [{ id: "lint", exit: 0 }] }));
    vm = applyEvent(vm, ev(6, "judge.report", { seat: "qa-functional", taskId: "t-1", verdict: "pass", findings: 0 }));
    expect(vm.dagNodes[0].state).toBe("done");
    expect(vm.lanes[0].status).toBe("idle");
    expect(vm.gates[0].verdict).toBe("pass");
    expect(vm.judges[0].seat).toBe("qa-functional");
  });

  test("gate re-report replaces; judge reports append", () => {
    let vm = emptyView();
    vm = applyEvent(vm, ev(1, "gate.report", { taskId: "t-1", verdict: "fail", checks: [] }));
    vm = applyEvent(vm, ev(2, "gate.report", { taskId: "t-1", verdict: "pass", checks: [] }));
    expect(vm.gates).toHaveLength(1);
    expect(vm.gates[0].verdict).toBe("pass");
    vm = applyEvent(vm, ev(3, "judge.report", { seat: "qa-functional", verdict: "pass", findings: 0 }));
    vm = applyEvent(vm, ev(4, "judge.report", { seat: "qa-adversarial", verdict: "pass", findings: 1 }));
    expect(vm.judges).toHaveLength(2);
  });

  test("readyNodes respects deps", () => {
    const vm = projectMissions([
      ev(1, "mission.created", { intent: "x" }),
      ev(2, "task.upsert", { id: "t-1", stage: "build", state: "done", deps: [] }),
      ev(3, "task.upsert", { id: "t-2", stage: "build", state: "pending", deps: ["t-1"] }),
      ev(4, "task.upsert", { id: "t-3", stage: "build", state: "pending", deps: ["t-2"] }),
    ]);
    expect(readyNodes(vm, "m-1").map((n) => n.id)).toEqual(["t-2"]);
  });

  test("viewer summary + staleness badge", () => {
    const vm = projectMissions([
      ev(1, "mission.created", { intent: "Add a healthcheck endpoint" }),
      ev(2, "task.upsert", { id: "t-1", stage: "build", state: "running", deps: [] }),
    ]);
    const fresh = renderMissionSummary(vm, { asOfSeq: 2, headSeq: 2 });
    expect(fresh).toContain("m-1");
    expect(fresh).not.toContain("STALE");
    expect(isStale({ asOfSeq: 1, headSeq: 2 })).toBe(true);
    const stale = renderMissionSummary(vm, { asOfSeq: 1, headSeq: 2 });
    expect(stale).toContain("STALE");
    const card = renderMissionCard(vm, "m-1", { asOfSeq: 2, headSeq: 2 });
    expect(card).toContain("healthcheck");
    expect(renderMissionCard(vm, "nope", { asOfSeq: 2, headSeq: 2 })).toContain("unknown mission");
  });

  test("card escapes operator-controlled strings", () => {
    const vm = projectMissions([
      ev(1, "mission.created", { intent: "<script>alert(1)</script>" }),
    ]);
    expect(renderMissionCard(vm, "m-1", { asOfSeq: 1, headSeq: 1 })).not.toContain("<script>");
  });
});
