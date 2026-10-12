# `@heretek-ai/pack-sdk`

Shared contract for Tier 2 domain packs (`opencode-packs` monorepo).

## Contract

```ts
import { definePack, packConformance, hostSatisfiesCompat } from "@heretek-ai/pack-sdk";

export default definePack({
  id: "mypack",
  version: "1.0.0",
  hostCompat: "2.0.x",
  laneRequires: [{ capability: "mypack", image: "ghcr.io/heretek-opencode/lane-mypack:1.x" }],
  tools: [{ server: "./mcp/mypack.js", transport: "stdio" }],
  skills: ["./skills/mypack.md"],
  commands: [{ name: "mypack.do", handler: "tools.mypackDo" }],
  hooks: { toolGuard: "./src/guard.ts" },
  ready: async (hostVersion) =>
    hostSatisfiesCompat("2.0.x", hostVersion)
      ? { status: "ready" }
      : { status: "degraded", reason: `needs host 2.0.x, got ${hostVersion}` },
});
```

## Rules

- `hostCompat` supports exact (`2.0.26`), x-range (`2.0.x`), caret, tilde, `*`.
- `packConformance(manifest)` checks: manifest valid, hostCompat well-formed,
  hook signatures present, tool entries JSON round-trip, `ready()` is a function,
  lane image ref present whenever `laneRequires` is declared.
- Readiness is a handshake, not a crash: a pack that cannot verify its runtime
  (missing binary, unreachable MCP) returns `{ status: "degraded", reason }`
  with a machine-readable, actionable reason.
- All `@opencode/*` dependencies in every pack are pinned exact (`2.0.26`).
