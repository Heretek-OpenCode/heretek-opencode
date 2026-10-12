// Minimal MissionViewer: framework-free render helpers + integration notes.
//
// NOTE (for the cockpit shell owner): this package intentionally ships no
// React/Solid dependency. `renderMissionSummary` returns plain text/HTML
// strings so any shell (React via dangerouslySetInnerHTML, Solid, terminal)
// can embed them. State always comes from `projectMissions` — the viewer
// never fetches, never mutates, shows a staleness badge when `asOfSeq`
// lags the stream head (STC hub-and-spoke `useProjection` pattern).
import type { MissionsViewModel } from "../projections/missions";
import { readyNodes } from "../projections/missions";

export interface ViewerMeta {
  asOfSeq: number;
  headSeq: number;
}

export function isStale(meta: ViewerMeta): boolean {
  return meta.asOfSeq < meta.headSeq;
}

/** One-line per mission + ready-task counts, suitable for terminal or card. */
export function renderMissionSummary(vm: MissionsViewModel, meta: ViewerMeta): string {
  const lines: string[] = [];
  if (isStale(meta)) lines.push(`[STALE asOf=${meta.asOfSeq} head=${meta.headSeq}]`);
  for (const m of vm.missions) {
    const ready = readyNodes(vm, m.id).length;
    const total = vm.dagNodes.filter((n) => n.missionId === m.id).length;
    const gates = vm.gates.filter((g) =>
      vm.dagNodes.some((n) => n.missionId === m.id && n.id === g.taskId),
    );
    const fails = gates.filter((g) => g.verdict !== "pass").length;
    lines.push(
      `${m.id} [${m.state}] ready=${ready}/${total} gatesFail=${fails} :: ${m.intent}`,
    );
  }
  return lines.join("\n");
}

/** Minimal HTML card for one mission (shell escapes intent — see NOTES). */
export function renderMissionCard(
  vm: MissionsViewModel,
  missionId: string,
  meta: ViewerMeta,
): string {
  const m = vm.missions.find((x) => x.id === missionId);
  if (!m) return `<div class="mission missing">unknown mission ${escapeHtml(missionId)}</div>`;
  const nodes = vm.dagNodes.filter((n) => n.missionId === missionId);
  const stale = isStale(meta)
    ? `<span class="badge stale">stale asOf=${meta.asOfSeq} head=${meta.headSeq}</span>`
    : `<span class="badge fresh">live seq=${meta.headSeq}</span>`;
  const items = nodes
    .map((n) => `<li data-task="${escapeHtml(n.id)}" data-state="${escapeHtml(n.state)}">${escapeHtml(n.id)} · ${escapeHtml(n.stage)} · ${escapeHtml(n.state)}</li>`)
    .join("");
  return `<section class="mission"><h2>${escapeHtml(m.id)} [${escapeHtml(m.state)}]</h2>${stale}<p>${escapeHtml(m.intent)}</p><ul>${items}</ul></section>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
