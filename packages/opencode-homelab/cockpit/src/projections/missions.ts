// Pure projection: Fleet JSON-RPC events -> cockpit missions view-model.
// Framework-free (mirrors STC `useProjection` hub-and-spoke: the UI never
// owns state, it projects a single event stream). No network, no Date.now()
// inside reducers — pass timestamps in events for deterministic tests.

export type FleetEventType =
  | "mission.created"
  | "mission.state"
  | "task.upsert"
  | "task.state"
  | "lane.status"
  | "gate.report"
  | "judge.report";

export interface FleetEvent {
  seq: number;
  at: string;
  type: FleetEventType;
  missionId: string;
  payload: Record<string, unknown>;
}

export interface MissionView {
  id: string;
  intent: string;
  state: string;
}

export interface DagNode {
  id: string;
  missionId: string;
  stage: string;
  state: string;
  deps: string[];
}

export interface LaneView {
  id: string;
  tier: string;
  status: string;
  taskId: string | null;
}

export interface GateView {
  taskId: string;
  verdict: string;
  checks: Array<{ id: string; exit: number }>;
}

export interface JudgeView {
  seat: string;
  missionId: string;
  taskId: string | null;
  verdict: string;
  findings: number;
}

export interface MissionsViewModel {
  missions: MissionView[];
  dagNodes: DagNode[];
  lanes: LaneView[];
  gates: GateView[];
  judges: JudgeView[];
}

export function emptyView(): MissionsViewModel {
  return { missions: [], dagNodes: [], lanes: [], gates: [], judges: [] };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** Fold one event into the view-model (pure; returns a new object). */
export function applyEvent(vm: MissionsViewModel, ev: FleetEvent): MissionsViewModel {
  const next: MissionsViewModel = {
    missions: [...vm.missions],
    dagNodes: [...vm.dagNodes],
    lanes: [...vm.lanes],
    gates: [...vm.gates],
    judges: [...vm.judges],
  };
  const p = ev.payload ?? {};
  switch (ev.type) {
    case "mission.created": {
      if (!next.missions.some((m) => m.id === ev.missionId)) {
        next.missions.push({
          id: ev.missionId,
          intent: str(p["intent"], ev.missionId),
          state: "pending",
        });
      }
      break;
    }
    case "mission.state": {
      const m = next.missions.find((m) => m.id === ev.missionId);
      if (m) m.state = str(p["state"], m.state);
      else next.missions.push({ id: ev.missionId, intent: ev.missionId, state: str(p["state"], "pending") });
      break;
    }
    case "task.upsert":
    case "task.state": {
      const id = str(p["id"] ?? p["taskId"]);
      if (!id) break;
      const node: DagNode = {
        id,
        missionId: ev.missionId,
        stage: str(p["stage"], "build"),
        state: str(p["state"], "pending"),
        deps: Array.isArray(p["deps"]) ? (p["deps"] as unknown[]).filter((d): d is string => typeof d === "string") : [],
      };
      const i = next.dagNodes.findIndex((n) => n.id === id);
      if (i >= 0) next.dagNodes[i] = { ...next.dagNodes[i], ...node };
      else next.dagNodes.push(node);
      break;
    }
    case "lane.status": {
      const id = str(p["id"] ?? p["lane"]);
      if (!id) break;
      const lane: LaneView = {
        id,
        tier: str(p["tier"], "docker"),
        status: str(p["status"], "unknown"),
        taskId: typeof p["taskId"] === "string" ? p["taskId"] : null,
      };
      const i = next.lanes.findIndex((l) => l.id === id);
      if (i >= 0) next.lanes[i] = lane;
      else next.lanes.push(lane);
      break;
    }
    case "gate.report": {
      const taskId = str(p["taskId"]);
      if (!taskId) break;
      const gate: GateView = {
        taskId,
        verdict: str(p["verdict"], "fail"),
        checks: Array.isArray(p["checks"])
          ? (p["checks"] as Array<Record<string, unknown>>).map((c) => ({
              id: str(c["id"]),
              exit: typeof c["exit"] === "number" ? c["exit"] : -1,
            }))
          : [],
      };
      const i = next.gates.findIndex((g) => g.taskId === taskId);
      if (i >= 0) next.gates[i] = gate;
      else next.gates.push(gate);
      break;
    }
    case "judge.report": {
      next.judges.push({
        seat: str(p["seat"]),
        missionId: ev.missionId,
        taskId: typeof p["taskId"] === "string" ? p["taskId"] : null,
        verdict: str(p["verdict"], "fail"),
        findings: typeof p["findings"] === "number" ? p["findings"] : 0,
      });
      break;
    }
  }
  return next;
}

/**
 * Project an unordered batch of Fleet JSON-RPC events into the view-model.
 * Events are applied in `seq` order (stable); out-of-order delivery from
 * JSON-RPC notifications is therefore harmless.
 */
export function projectMissions(events: FleetEvent[]): MissionsViewModel {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  return ordered.reduce(applyEvent, emptyView());
}

/** Ready-set: dag nodes whose deps are all done and which are not done. */
export function readyNodes(vm: MissionsViewModel, missionId: string): DagNode[] {
  const nodes = vm.dagNodes.filter((n) => n.missionId === missionId);
  const done = new Set(nodes.filter((n) => n.state === "done").map((n) => n.id));
  return nodes.filter(
    (n) => n.state !== "done" && n.state !== "cancelled" && n.deps.every((d) => done.has(d)),
  );
}
