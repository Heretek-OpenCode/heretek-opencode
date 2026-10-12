# @heretek-ai/homelab-cockpit

Framework-free cockpit surfaces for the homelab tier.

- `src/projections/missions.ts` — pure fold of Fleet JSON-RPC events into
  `{ missions, dagNodes, lanes, gates, judges }`. Events apply in `seq`
  order, so out-of-order notifications are harmless. No network, no clock
  inside reducers (deterministic tests).
- `src/components/MissionViewer.ts` — minimal render helpers
  (`renderMissionSummary`, `renderMissionCard`) returning strings any shell
  (React/Solid/terminal) can embed. Never fetches, never mutates; shows a
  staleness badge when `asOfSeq < headSeq` (STC hub-and-spoke pattern).
- `src/components/NOTES.md` — shell integration notes (escaping, dual-QA
  inspector plan, gate chips).

```sh
bun test ./test   # from packages/opencode-homelab/cockpit
```
