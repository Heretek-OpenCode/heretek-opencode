# `@heretek-ai/pack-godot`

Godot 4 domain pack: host-side plugin entry (`src/`), GDScript companion
addon artifact (`companion/`), scene skill (`skills/`), headless lane image
(`Dockerfile.lane`).

- Exact `@opencode/plugin` pin: `2.0.26` (fixes the donor's unpinned drift).
- `ready(hostVersion)` requires host `2.0.x` and a resolvable `godot` binary;
  otherwise it returns `degraded` with an actionable reason.
- `companion/` ships as the versioned `godot_opencode-<version>.zip` release
  artifact; only identity files live in-repo.
