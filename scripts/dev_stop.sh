#!/usr/bin/env bash
# Save The Wildlife - Stop all local dev services (web, ws-server, score, bots)

set -euo pipefail

echo "Stopping local dev services..."

kill_by_pattern() {
  local pattern="$1"
  local pids
  pids=$(pgrep -fal "$pattern" | awk '{print $1}' || true)
  if [[ -n "${pids:-}" ]]; then
    echo "SIGTERM for processes matching: $pattern (PIDs: $pids)"
    pkill -f "$pattern" || true
  fi
}

kill_by_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids:-}" ]]; then
    echo "SIGTERM for listeners on port $port (PIDs: $pids)"
    kill $pids || true
  fi
}

force_kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${pids:-}" ]]; then
    echo "SIGKILL for stubborn listeners on port $port (PIDs: $pids)"
    kill -9 $pids || true
  fi
}

echo "— Graceful termination by process patterns"
# Webpack dev-server
kill_by_pattern "webpack.*serve"
# Node WS server (index.js via nodemon)
kill_by_pattern "save-the-wildlife/server/index.js|nodemon index.js"
# Spring Boot (Gradle BootRun / embedded loader)
kill_by_pattern "org\\.springframework\\.boot\\.loader|GradleDaemon"
# Bots
kill_by_pattern "save-the-wildlife/bots/index.js"

echo "— Graceful termination by ports"
for p in 8081 3000 8080; do
  kill_by_port "$p"
done

sleep 2

echo "— Force kill if still present"
for p in 8081 3000 8080; do
  force_kill_port "$p"
done

echo "— Port status (should be free)"
for p in 8081 3000 8080; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  Port $p: STILL IN USE"
  else
    echo "  Port $p: free"
  fi
done

echo "All stop operations attempted."
