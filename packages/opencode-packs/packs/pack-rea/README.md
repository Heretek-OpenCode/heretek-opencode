# `@heretek-ai/pack-rea`

REA reverse-engineering domain pack: standardized `readiness.ts` handshake
plus agent and skill stubs.

- Exact pins: `@opencode/plugin` / `@opencode/cli` / `@opencode/sdk` `2.0.26`.
- `ready(hostVersion)` requires host `2.0.x` **and** a responsive REA side
  (`rea` CLI on PATH); otherwise `degraded` with actionable remediation
  (`rea doctor --client opencode --json`, `rea setup --client opencode --dry-run`).
- The readiness pattern here is the reference implementation promoted into
  `@heretek-ai/pack-sdk`'s pack contract.
