# @heretek-ai/fleet

Lean build factory and fleet engine: missions, task DAGs, throwaway lanes, mechanical gates, dual QA judges, and human-only PRs.

## Trust model

No key ceremonies, no sealed envelopes, no separate audit harness. Evidence is:

1. **Git commit SHAs** — every task works on `fleet/<taskId>`; integration on `fleet/integration/<missionId>`. History is the record.
2. **sha256 journal chains** — every state transition appends a JSONL line `{ seq, at, actor, event, prevHash, hash }`. `verify()` recomputes the chain; any edit breaks it.
3. **GitHub branch protection** — only humans merge to main; only humans record waivers.
4. **Human PR review** — the PR body carries the criteria-to-evidence table, gate reports, and both judge reports with content hashes. Reviewers reproduce every number from the merge-base SHA.

If evidence cannot be reproduced from the repo + journal, it is not trusted — regardless of where it came from.

## Layout

```
src/
  state/      Mission/Task/Criterion types (re-exported from @heretek-ai/sdk)
              + JSONL prev-hash journal: append, verify, snapshot save/load, resume
  dag/        topo sort, cycle detection, ready-set computation
  scheduler/  run loop, rework cap (2), escalation to waiting_human, goal-drift guard
  lanes/      tier select (bwrap | docker | dagger), worktree lifecycle,
              salvage refs refs/fleet-salvage/<taskId>
  host/       adapter for one `opencode serve` instance (prompt/steer/wait/diff)
  gates/      mechanical gate runner + budget enforcement, SDK-shaped GateReport
  judges/     qa-functional + qa-adversarial prompt templates and report parsers
  pipeline/   grill -> research -> spec -> build/dual-QA -> human-PR stage defs
              with I/O artifacts mission.md / research.md / spec.md / tasks.json
  cli/        grill | research | spec | run | status | approve | resume | steer
  util/       sha256, process exec with first-class timeouts, secret redaction
```

## Pipeline

| Stage | Output | Exit |
|---|---|---|
| Grill | `mission.md` | every criterion verifiable; no blocking open questions |
| Research | `research.md` | ≥3 sources, freshness + verified/inferred tags, content hashes |
| Spec | `spec.md` + `tasks.json` | acyclic DAG, full criterion coverage, per-task budgets |
| Build ⇄ Dual QA | commits + reports | gates green AND both judges pass; rework cap 2, then `waiting_human` |
| Human PR | PR body | evidence table + reports + diffs; **human-only merge** |

## Rework contract

- A failed task (gates or either judge) requeues while attempts ≤ 3 (initial + 2 reworks). Past the cap it becomes `waiting_human`.
- Judge disagreement mints a dedicated fix task (`<id>-fix-<n>`, depends on the original). Judges never negotiate; both verdicts stay on the record.
- `goalUnchanged(initial, ctx)` guards the spec: intent overlap, criterion presence, no silent weakening of verify methods, no un-grilled scope additions.

## CLI

```sh
fleet grill    --mission m-1 --intent "..."   # mission.md
fleet research --mission m-1 --notes "..."    # research.md
fleet spec     --mission m-1                  # spec.md + tasks.json
fleet run      --mission m-1                  # execute DAG to settlement
fleet status   --mission m-1                  # mission + task states
fleet approve  --mission m-1 --criterion c1   # human waiver (operators only)
fleet resume   --mission m-1                  # replay journal tail after crash
fleet steer    --mission m-1 --note "..."     # operator steer event
```

## SDK dependency

Domain schemas (`Mission`, `Task`, `Criterion`, `GateReport`) are owned by `@heretek-ai/sdk` (`packages/opencode-sdk/src/contracts.ts`) and imported via relative path — never duplicated here.
