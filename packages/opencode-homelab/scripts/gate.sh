#!/usr/bin/env bash
# Homelab gate order (ported from STC/scripts/gate.sh).
# Enforced sequence on the homelab package:
#   lint (oxlint) -> typecheck (tsc --noEmit) -> tests (bun test)
# Fail-fast: the first failing gate stops the run.
#
# Exit 0 = all gates clean.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { echo; echo "=== gate: $1 ==="; }
fail() { echo "GATE FAILED: $1"; exit 1; }

step "lint (oxlint)"
bunx oxlint || fail "oxlint"

step "typecheck (tsc --noEmit)"
bunx tsc --noEmit || fail "typecheck"

step "tests (bun test)"
bun run test || fail "tests"

echo
echo "GATE ORDER: PASS"
