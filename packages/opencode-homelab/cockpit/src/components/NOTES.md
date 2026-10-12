# MissionViewer integration notes (cockpit shell owner)

- Source of truth: Fleet JSON-RPC notification stream → `projectMissions(events)`.
  The viewer receives `{ vm, meta: { asOfSeq, headSeq } }` as props; it never
  fetches and never mutates (STC hub-and-spoke pattern).
- Staleness: show the `[STALE]` badge whenever `asOfSeq < headSeq`; the shell
  owns the 1s poll cadence and per-view error slots (cf. STC `useProjection`).
- Escaping: `renderMissionCard` escapes all mission-controlled strings.
  Intents and task ids are operator input — never interpolate unescaped.
- Dual QA inspector (next step): render `vm.judges` grouped by `seat`
  (`qa-functional` vs `qa-adversarial`), linking each verdict to its
  `taskId` evidence; disagreements on the same criterion escalate visually.
- Gate chips: `vm.gates` verdicts color per task chip; non-`pass` blocks the
  merge affordance (human-only merge stays enforced server-side).
