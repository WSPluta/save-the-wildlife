#!/usr/bin/env bash
# Save The Wildlife - Minimal dev start (WS server + Web only)
# - Stops any existing listeners first
# - Starts Node WS server on :3000 with clustered realtime disabled
# - Starts Webpack Dev Server on :8081
# - Score service is optional (enable with START_SCORE=1)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")"/.. &>/dev/null && pwd)"

echo "=== Stopping existing dev services"
bash "$ROOT_DIR/scripts/dev_stop.sh" || true

echo "=== Starting WS Server (Node) on :3000 (backends disabled)"
(
  cd "$ROOT_DIR"
  REALTIME_CLUSTER_BACKEND=memory ENABLE_COHERENCE_BACKEND=false PORT=3000 npm --prefix server start
) &

if [[ "${START_SCORE:-0}" == "1" ]]; then
  echo "=== Starting Score (Spring Boot) on :8080"
  (
    cd "$ROOT_DIR/score"
    ./gradlew bootRun
  ) &
else
  echo "=== Skipping Score service (set START_SCORE=1 to enable)"
fi

echo "=== Starting Web (webpack-dev-server) on :8081"
(
  cd "$ROOT_DIR/web"
  npm run dev
) &

echo "=== Use this to diagnose: bash $ROOT_DIR/scripts/dev_diag.sh"
echo "=== WS Server: http://localhost:3000/healthz"
echo "=== Web:       http://localhost:8081/"
echo "=== Score:     http://localhost:8080/ (if START_SCORE=1)"
wait
