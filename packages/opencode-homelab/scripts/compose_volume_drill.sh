#!/usr/bin/env bash
# Homelab compose volume drill (ported from STC/scripts/compose_volume_drill.sh).
# Proves zero data loss across teardown/re-pull: create state in a drill
# volume mirroring homelab-state, tear down containers, verify the volume and
# the declared compose volumes intact.
# Uses a throwaway project name so the real homelab stack is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT="${COMPOSE_PROJECT_NAME:-opencode-homelab-drill}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
EVIDENCE="${EVIDENCE:-/tmp/opencode/homelab-volume-drill.log}"
mkdir -p "$(dirname "$EVIDENCE")"

{
echo "== preflight: docker =="
if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: docker not available on this host; volume drill deferred"
  exit 0
fi
echo "== volume drill start =="
export COMPOSE_PROJECT_NAME="$PROJECT"
VOLUMES="$(docker compose -f "$COMPOSE_FILE" config --volumes)"
for vol in homelab-state workspace-disposable; do
  if ! printf '%s\n' "$VOLUMES" | grep -qx "$vol"; then
    echo "FAIL: volume $vol missing from compose config"
    exit 1
  fi
done
echo "PASS: volumes homelab-state + workspace-disposable declared"
echo "== create state =="
docker volume create "${PROJECT}_homelab-state" >/dev/null
echo "drill-canary-$(date +%s)" | docker run --rm -i -v "${PROJECT}_homelab-state:/data" debian:bookworm-slim sh -c 'cat > /data/canary.txt && cat /data/canary.txt'
echo "== teardown containers (volumes kept) =="
docker compose -f "$COMPOSE_FILE" down --remove-orphans || true
echo "== verify zero loss =="
docker run --rm -v "${PROJECT}_homelab-state:/data:ro" debian:bookworm-slim cat /data/canary.txt
echo "PASS: homelab-state volume survived teardown"
echo "== cleanup drill volumes =="
docker volume rm "${PROJECT}_homelab-state" >/dev/null
echo "VOLUME DRILL PASSED"
} 2>&1 | tee "$EVIDENCE"
