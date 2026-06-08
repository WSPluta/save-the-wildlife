#!/usr/bin/env bash
# Save The Wildlife - Robust local dev start
# Starts selected services with health checks and log redirection.
# Default: start Web (8080) + WS Server (3000); Score and Bots are optional.
#
# Usage:
#   bash scripts/dev_start.sh [--clean|--no-clean] [--all|--web|--server|--score|--bots ...]
# Env overrides:
#   WEB_PORT=8080 SERVER_PORT=3000 SCORE_PORT=8082
#   ENABLE_REDIS_BACKEND=false ENABLE_COHERENCE_BACKEND=false
#   START_SCORE=0 START_BOTS=0   # can be set to 1 to force enable
#
# Examples:
#   bash scripts/dev_start.sh --clean --web --server
#   START_SCORE=1 bash scripts/dev_start.sh --all
#   WEB_PORT=9090 bash scripts/dev_start.sh --web

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")"/.. &>/dev/null && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

WEB_PORT="${WEB_PORT:-8080}"
SERVER_PORT="${SERVER_PORT:-3000}"
SCORE_PORT="${SCORE_PORT:-8082}"

# Defaults: none selected yet; if none selected we default to web+server later
START_WEB=0
START_SERVER=0
START_SCORE="${START_SCORE:-0}"
START_BOTS="${START_BOTS:-0}"
DO_CLEAN=1
ANY_SELECTED=0

# Parse args
if [[ $# -gt 0 ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --clean) DO_CLEAN=1 ;;
      --no-clean) DO_CLEAN=0 ;;
      --all)
        START_WEB=1
        START_SERVER=1
        START_SCORE=1
        START_BOTS=1
        ANY_SELECTED=1
        ;;
      --web)
        START_WEB=1
        ANY_SELECTED=1
        ;;
      --server)
        START_SERVER=1
        ANY_SELECTED=1
        ;;
      --score)
        START_SCORE=1
        ANY_SELECTED=1
        ;;
      --bots)
        START_BOTS=1
        ANY_SELECTED=1
        ;;
      *)
        echo "Unknown argument: $1"
        echo "Usage: bash scripts/dev_start.sh [--clean|--no-clean] [--all|--web|--server|--score|--bots ...]"
        exit 1
        ;;
    esac
    shift
  done
fi

# If no services explicitly selected, default to starting web + server
if [[ "$ANY_SELECTED" -eq 0 ]]; then
  START_WEB=1
  START_SERVER=1
fi

# Clean stop if requested
if [[ "$DO_CLEAN" -eq 1 ]]; then
  echo "=== Stopping existing dev services (clean)"
  bash "$ROOT_DIR/scripts/dev_stop.sh" || true
else
  echo "=== Skipping clean stop (--no-clean)"
fi

# Preflight checks
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: Required command '$1' not found"; exit 1; }
}
need_cmd node
need_cmd npm
if [[ "$START_SCORE" -eq 1 ]]; then
  need_cmd java
fi
if command -v lsof >/dev/null 2>&1; then
  :
else
  echo "WARN: 'lsof' not found; port checks will be limited"
fi

# Helpers
port_free_or_exit() {
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: Port $port is already in use. Run: bash scripts/dev_stop.sh"
    exit 1
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local timeout="${3:-30}" # seconds
  local elapsed=0
  echo "Waiting for $name at $url (timeout ${timeout}s)"
  until curl -fsS "$url" -o /dev/null 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed+1))
    if [[ $elapsed -ge $timeout ]]; then
      echo "WARN: $name not healthy after ${timeout}s (continuing)"
      return 1
    fi
  done
  echo "$name is healthy."
  return 0
}

# Ensure ports are free before start
[[ "$START_WEB" -eq 1 ]] && port_free_or_exit "$WEB_PORT"
[[ "$START_SERVER" -eq 1 ]] && port_free_or_exit "$SERVER_PORT"
[[ "$START_SCORE" -eq 1 ]] && port_free_or_exit "$SCORE_PORT"

# Start functions
start_server() {
  echo "=== Starting WS Server (Node) on :$SERVER_PORT (backends disabled by default)"
  ENABLE_REDIS_BACKEND="${ENABLE_REDIS_BACKEND:-false}" \
  ENABLE_COHERENCE_BACKEND="${ENABLE_COHERENCE_BACKEND:-false}" \
  PORT="$SERVER_PORT" \
  nohup npm --prefix "$ROOT_DIR/server" start \
    > "$LOG_DIR/server.out.log" 2> "$LOG_DIR/server.err.log" &

  echo $! > "$LOG_DIR/server.pid"
  echo "Server PID: $(cat "$LOG_DIR/server.pid")  logs: $LOG_DIR/server.*.log"
}

start_web() {
  echo "=== Starting Web (webpack-dev-server) on :$WEB_PORT"
  # Ensure the webpack.dev.js is configured to use $WEB_PORT if needed (currently defaults to 8080)
  WEB_PORT="$WEB_PORT" nohup bash -c "cd '$ROOT_DIR/web' && npm run dev" \
    > "$LOG_DIR/web.out.log" 2> "$LOG_DIR/web.err.log" &

  echo $! > "$LOG_DIR/web.pid"
  echo "Web PID: $(cat "$LOG_DIR/web.pid")  logs: $LOG_DIR/web.*.log"
}

start_score() {
  echo "=== Starting Score (Spring Boot) on :$SCORE_PORT"
  local profile="default"
  local dbEnv=""
  if [[ -f "$ROOT_DIR/.env.json" ]]; then
    local useLocal=$(jq -r '.USE_LOCAL_DB // "false"' "$ROOT_DIR/.env.json" 2>/dev/null || echo "false")
    if [[ "$useLocal" == "true" ]]; then
      profile="local"
      local host=$(jq -r '.ORACLE_DB_HOST // "localhost"' "$ROOT_DIR/.env.json" 2>/dev/null || echo "localhost")
      local port=$(jq -r '.ORACLE_DB_PORT // "1521"' "$ROOT_DIR/.env.json" 2>/dev/null || echo "1521")
      local name=$(jq -r '.ORACLE_DB_NAME // "FREEPDB1"' "$ROOT_DIR/.env.json" 2>/dev/null || echo "FREEPDB1")
      local user=$(jq -r '.ORACLE_DB_USERNAME // "ADMIN"' "$ROOT_DIR/.env.json" 2>/dev/null || echo "ADMIN")
      local pass=$(jq -r '.ORACLE_DB_PASSWORD // ""' "$ROOT_DIR/.env.json" 2>/dev/null || echo "")
      dbEnv="ORACLE_DB_HOST='$host' ORACLE_DB_PORT='$port' ORACLE_DB_NAME='$name' ORACLE_DB_USERNAME='$user' ORACLE_DB_PASSWORD='$pass' "
      echo "Using local Oracle DB with host $host:$port/$name"
    else
      echo "Using cloud ADB"
    fi
  fi
  echo "Using Spring profile: $profile"
  # Spring Boot 2.x can accept server.port via system property or env
  nohup bash -c "cd '$ROOT_DIR/score' && $dbEnv SERVER_PORT='$SCORE_PORT' SPRING_PROFILES_ACTIVE='$profile' ./gradlew bootRun" \
    > "$LOG_DIR/score.out.log" 2> "$LOG_DIR/score.err.log" &

  echo $! > "$LOG_DIR/score.pid"
  echo "Score PID: $(cat "$LOG_DIR/score.pid")  logs: $LOG_DIR/score.*.log"
}

start_bots() {
  echo "=== Starting Bots (connect to ws://localhost:$SERVER_PORT)"
  nohup bash -c "cd '$ROOT_DIR/bots' && WS_SERVER_SERVICE_HOST='localhost' WS_SERVER_SERVICE_PORT='$SERVER_PORT' node index.js" \
    > "$LOG_DIR/bots.out.log" 2> "$LOG_DIR/bots.err.log" &

  echo $! > "$LOG_DIR/bots.pid"
  echo "Bots PID: $(cat "$LOG_DIR/bots.pid")  logs: $LOG_DIR/bots.*.log"
}

# Start selected services
if [[ "$START_SERVER" -eq 1 ]]; then start_server; fi
if [[ "$START_SCORE" -eq 1 ]]; then start_score; fi
if [[ "$START_WEB" -eq 1 ]]; then start_web; fi
if [[ "$START_BOTS" -eq 1 ]]; then start_bots; fi

# Health checks
if [[ "$START_SERVER" -eq 1 ]]; then
  wait_for_http "http://localhost:${SERVER_PORT}/healthz" "WS Server (/healthz)" 30 || true
  # Socket.IO polling handshake (should return 200)
  wait_for_http "http://localhost:${SERVER_PORT}/socket.io/?EIO=4&transport=polling" "Socket.IO polling" 20 || true
fi

if [[ "$START_WEB" -eq 1 ]]; then
  wait_for_http "http://localhost:${WEB_PORT}/" "Web (webpack-dev-server)" 30 || true
fi

if [[ "$START_SCORE" -eq 1 ]]; then
  wait_for_http "http://localhost:${SCORE_PORT}/actuator/health" "Score (/actuator/health)" 45 || true
fi

echo
echo "=== Summary"
[[ -f "$LOG_DIR/web.pid" ]] && echo "Web:   PID $(cat "$LOG_DIR/web.pid")   http://localhost:${WEB_PORT}/"
[[ -f "$LOG_DIR/server.pid" ]] && echo "Server: PID $(cat "$LOG_DIR/server.pid") http://localhost:${SERVER_PORT}/healthz"
[[ -f "$LOG_DIR/score.pid" ]] && echo "Score: PID $(cat "$LOG_DIR/score.pid")   http://localhost:${SCORE_PORT}/actuator/health"
[[ -f "$LOG_DIR/bots.pid" ]] && echo "Bots:  PID $(cat "$LOG_DIR/bots.pid")"

echo
echo "Logs directory: $LOG_DIR"
echo "Stop everything: bash $ROOT_DIR/scripts/dev_stop.sh"
echo "Diagnostics:     bash $ROOT_DIR/scripts/dev_diag.sh"
