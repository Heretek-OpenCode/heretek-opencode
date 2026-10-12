#!/usr/bin/env bash
# Homelab compose smoke test (ported from STC/scripts/compose_lane_smoke.sh).
# Proves: (1) compose.yaml validates (`docker compose config`), (2) required
# networks frontend+internal exist, (3) fail-closed defaults hold (no
# docker.sock mount, no privileged), (4) required services
# distro/gateway/fleet/valkey are present.
# Hardening posture (rootless services, cap_drop ALL, no-new-privileges) is
# declared in compose.yaml; this script guards the topology, not the images.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
EVIDENCE="${EVIDENCE:-/tmp/opencode/homelab-lane-smoke.log}"
mkdir -p "$(dirname "$EVIDENCE")"

{
echo "== preflight: docker =="
if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: docker not available on this host; compose smoke deferred"
  exit 0
fi
echo "== compose config validation =="
docker compose -f "$COMPOSE_FILE" config >/dev/null
echo "PASS: docker compose config validates ($COMPOSE_FILE)"
echo "== networks frontend+internal =="
NETWORKS="$(docker compose -f "$COMPOSE_FILE" config --networks)"
for net in frontend internal; do
  if ! printf '%s\n' "$NETWORKS" | grep -qx "$net"; then
    echo "FAIL: network $net missing from compose config"
    exit 1
  fi
done
if ! docker compose -f "$COMPOSE_FILE" config | grep -qE 'internal:\s*true'; then
  echo "FAIL: internal network must set internal:true (fleet/lane isolation)"
  exit 1
fi
echo "PASS: networks frontend+internal present (internal:true enforced)"
echo "== services distro/gateway/fleet/valkey =="
SERVICES="$(docker compose -f "$COMPOSE_FILE" config --services)"
for svc in distro gateway fleet valkey; do
  if ! printf '%s\n' "$SERVICES" | grep -qx "$svc"; then
    echo "FAIL: service $svc missing from compose config"
    exit 1
  fi
done
echo "PASS: services distro/gateway/fleet/valkey present"
echo "== socket-mount + privileged guard =="
if grep -vE '^\s*#' "$COMPOSE_FILE" | grep -q "docker.sock"; then
  echo "FAIL: compose.yaml must never socket-mount (dev override only)"
  exit 1
fi
if grep -vE '^\s*#' "$COMPOSE_FILE" | grep -qE 'privileged\s*:\s*true'; then
  echo "FAIL: compose.yaml must never set privileged:true (dev override only)"
  exit 1
fi
echo "PASS: no docker.sock or privileged in $COMPOSE_FILE"
echo "ALL LANE SMOKE CHECKS PASSED"
} 2>&1 | tee "$EVIDENCE"
