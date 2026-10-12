# @heretek-ai/homelab

Homelab & integration tier (STC successor): compose topology, `studio` operator
CLI, manager autonomy dial, cockpit mission projections, and the canonical
end-to-end mission test.

## Layout

```
packages/opencode-homelab/
├── compose.yaml              # distro + gateway + fleet + valkey topology
├── compose.override.dev.yaml # local live mounts (no privilege escalation)
├── config/autonomy.json      # autonomy dial setting (default: balanced)
├── src/autonomy.ts           # dial parse + stage gate
├── scripts/studio            # operator CLI: init|up|down|logs|status
├── scripts/test-e2e-mission.ts # canonical E2E (mock adapters, no docker)
├── cockpit/src/projections/missions.ts # Fleet events -> view-model
├── cockpit/src/components/   # minimal MissionViewer + notes
└── test/                     # unit tests
```

## Autonomy dial (from STC #8)

One explicit knob, `config/autonomy.json` → `{ "version": 1, "mode": ... }`:

| mode | semantics |
|---|---|
| `advisory` | stops at **every** stage for human confirmation |
| `balanced` (default) | stops only at **spec** and at the **human PR** gate |
| `full` | runs continuously, stops only for the **human PR** gate |

Merge is **always human-only** (branch protection) regardless of mode.
`requiresStop(mode, stage)` in `src/autonomy.ts` is the single decision
function; unknown modes/stages fail closed.

## Network boundaries

- `frontend`: gateway egress **only**. The gateway is the sole service with
  an external route (engines, registries). Nothing else is attached.
- `internal` (`internal: true`): distro, fleet, valkey. **No outside route** —
  lanes reach the network exclusively through gateway `POST /mcp`.
- All services rootless (`user: "1000:1000"`, `cap_drop: [ALL]`,
  `no-new-privileges`). No `privileged`, no `docker.sock`, no host network.

## Volumes & drills

- `homelab-state` (durable): fleet journal/snapshots, gateway audit chain,
  valkey dump. Survives `down` and image updates.
- `workspace-disposable` (ephemeral): per-task worktrees/lane mounts.
  Drill: `scripts/studio down -v` then `up` — missions must resume from
  `homelab-state` alone; anything that does not resume was state in the
  wrong volume.

## First run

```sh
scripts/studio init   # writes rootless .env (0600), generates OPENCODE_PASSWORD
scripts/studio up     # docker compose up -d
scripts/studio status # ps + config check
```

`init` **refuses** privileged-dev (`PRIVILEGED_DEV=1`) unless
`ALLOW_PRIVILEGED=1` is explicitly set (STC #9). Dev live mounts:
`docker compose -f compose.yaml -f compose.override.dev.yaml up`.

## Verification

```sh
bun test packages/opencode-homelab/test packages/opencode-homelab/cockpit/test
bun run scripts/test-e2e-mission.ts   # from packages/opencode-homelab; no docker
docker compose -f packages/opencode-homelab/compose.yaml config -q
```
