#!/usr/bin/env bash
# Save The Wildlife - Dev Diagnostics
# Quick checks for Web (webpack-dev-server), WS server, Score service, and Bots

set -euo pipefail

echo "=== Environment"
echo "Node: $(command -v node || echo 'not found') $(node -v 2>/dev/null || true)"
echo "NPM:  $(command -v npm || echo 'not found') $(npm -v 2>/dev/null || true)"
echo "Java: $(command -v java || echo 'not found')"
java -version 2>&1 | head -n1 || true
echo "JAVA_HOME: ${JAVA_HOME:-unset}"
echo

WEB_PORT="${WEB_PORT:-8080}"
SERVER_PORT="${SERVER_PORT:-3000}"
SCORE_PORT="${SCORE_PORT:-8082}"

echo "=== Listening Ports"
for p in "$WEB_PORT" "$SCORE_PORT" "$SERVER_PORT"; do
  echo "--- Port $p"
  if ! lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | sed 's/^/    /'; then
    echo "    no listener"
  fi
done
echo

http_check() {
  local url="$1" name="$2"
  echo "==> $name: $url"
  if command -v curl >/dev/null; then
    curl -sS -o /tmp/dev_diag.out -w "    HTTP %{http_code}  time %{time_total}s  size %{size_download}B\n" "$url" || echo "    curl failed"
    # Try to detect JSON validity (best-effort)
    if command -v jq >/dev/null; then
      if jq -e . </tmp/dev_diag.out >/dev/null 2>&1; then
        echo "    JSON: valid"
      else
        echo "    JSON: invalid or non-JSON"
      fi
    fi
  else
    echo "    curl not installed"
  fi
  echo
}

echo "=== HTTP/Health Checks"
# Web (webpack-dev-server)
http_check "http://localhost:${WEB_PORT}/" "Web (webpack-dev-server UI)"
# Webpack client websocket endpoint (HTTP probe of WS path shows if route exists)
http_check "http://localhost:${WEB_PORT}/ws" "Web (dev client WS path existence)"
# WS game server health (Terminus)
http_check "http://localhost:${SERVER_PORT}/healthz" "WS Server health"
# Socket.IO polling handshake (should return 200)
http_check "http://localhost:${SERVER_PORT}/socket.io/?EIO=4&transport=polling" "Socket.IO handshake (polling)"
# Score service (Spring Boot Actuator + API)
http_check "http://localhost:${SCORE_PORT}/actuator/health" "Score Actuator health"
http_check "http://localhost:${SCORE_PORT}/api/top/score" "Score leaderboard API"
echo

echo "=== Processes"
echo "-- Webpack dev-server"
pgrep -fal "webpack.*serve" || echo "none"
echo "-- Node WS server"
pgrep -fal "node .*server/index.js" || echo "none"
echo "-- Spring Boot (Gradle BootRun)"
pgrep -fal "GradleDaemon|org.springframework.boot.loader" || echo "none"
echo "-- Bots"
pgrep -fal "node .*bots/index.js" || echo "none"
echo

echo "=== Common Issues and Hints"
cat << 'HINTS'
- Webpack client WS errors like 'ws://localhost:8080/ws failed':
  Usually the dev server is not running on 8080, or client.webSocketURL is misconfigured.
  Fix: ensure webpack-dev-server runs on 8080 and avoid overriding client.webSocketURL unless necessary.

- Proxy EAGAIN on /api to 8082:
  Happens if your dev server also listens on 8080 (proxy loops back to itself).
  Run webpack-dev-server on 8080 and keep Score on 8082 to avoid conflicts.

- WS Server health (/healthz) failing:
  Ensure you started the Node server with required env. For local dev you can disable backends:
    REALTIME_CLUSTER_BACKEND=memory ENABLE_COHERENCE_BACKEND=false npm start

- Score build failing due to JDK/toolchain mismatch:
  Spring Boot 2.7 works with Java 11/17. Ensure your Gradle uses a compatible JDK.
  Workaround: run web without Score; UI will handle leaderboard unavailability gracefully.

- Bots connection:
  Bots require the WS server on :3000. Start bots only after WS server is healthy.
HINTS
