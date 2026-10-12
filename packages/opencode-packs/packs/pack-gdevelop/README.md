# `@heretek-ai/pack-gdevelop`

GDevelop domain pack: one consolidated boundary from the donor's four
packages (`ai-studio` + `opencode-gdevelop` + `unlock-shim`; the provider
bridge stays optional at `./provider-bridge`, BYOK only).

- Exact `@opencode/plugin` pin: `2.0.26`.
- `patches/` carries representative patch seams with automated
  `git apply --check` verification (`bun run verify-patches`) — the
  per-upstream-release rebase discipline (donor issue #13).
- **Donor fork decommissioned (donor issue #6):** the `GDevelop-Unlocked`
  donor fork is archived and its daily sync dropped. This pack is the single
  source of truth; the donor remains readable history only.
- `Dockerfile.lane` provides the reproducible verification environment.
