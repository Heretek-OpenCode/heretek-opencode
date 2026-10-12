# patches/ — GDevelop patch stack (representative samples + verification)

## Donor stack (context)

The `GDevelop-Unlocked` donor carried a 14-patch surgical stack
(`01-usage-predicate` … `14-ai-utils`) converting stock upstream GDevelop
source to fork parity: entitlement unlocks (01–06), AI generation glue and
BYOK routing (07–14), plus the `ai-studio` / `unlock-shim` runtime overlay
that the hunks import. Patches were generated, anchor-gated, and applied by
the donor's driver script before building.

## What lives here

This pack keeps **minimal representative patches** proving the rebase
discipline, not the full donor stack:

| Patch | Represents |
|---|---|
| `01-unlock-shim-stub.patch` | Electron-hook / control-shim preload seam (donor 06) |
| `02-ai-studio-mount.patch` | Studio runtime mount seam (donor 11) |

## Verification (donor issue #13)

`bun run verify-patches` (i.e. `scripts/verify-patches.ts`) asserts every
`*.patch` applies cleanly via `git apply --check` in a pristine temp repo.
On upstream GDevelop releases, CI re-runs this job and fails loudly on drift.

## Donor fork decommissioned (donor issue #6)

The donor fork is archived: daily sync is dropped, and this patch stack plus
the consolidated pack are the single source of truth. See `../README.md`.
