# Migration plan: three.js frontend to Godot

This document defines the plan to migrate the browser frontend from a three.js + Webpack application (web/) to a Godot-based client, while maintaining full compatibility with the existing backend and improving the DevOps pipeline. It assumes incremental, low-risk delivery with side-by-side deployment, canary traffic shifting, and clear rollback paths.

## Goals

- Replace the three.js browser client with a Godot-based client.
- Maintain a stable network contract with the Node.js backend (server/).
- Keep the CI/CD and deployment pipeline reliable; improve reproducibility and observability.
- Enable side-by-side and canary rollout, with fast rollback.
- Minimize backend changes; leverage existing godot/ and deploy/k8s base where possible.

## Non-goals

- Large-scale backend protocol refactors (unless explicitly opted-in).
- Rewriting game logic that already lives server-side.
- Changing current cloud/provider choices or base cluster topology.

---

## Current state (as-is)

- Frontend (web/):
  - three.js (0.179.x), Webpack 5, static assets under web/src/.
  - Socket.IO client (4.8.x) for real-time comms to Node backend.
  - Dockerfile produces static site, served by nginx.
  - K8s ingress routes HTTP to the web pod; WebSocket upgrades proxy to ws-server.

- Backend (server/):
  - Node.js, Socket.IO-based real-time endpoints with game logic (server/lib/gameLogic.js etc.).
  - Deployed with its own Docker image and k8s manifests.

- Godot artifacts already present:
  - godot/ (project.godot, scenes, scripts) and godot/bridge/ (Node bridge).
  - K8s manifests under deploy/k8s/base/godot and deploy/k8s/base/godot-bridge.

- Deployment:
  - Multi-service k8s setup under deploy/k8s with overlays.
  - web/ Dockerfile: Node builder -> nginx static.

---

## Target state (to-be)

- Frontend: Godot 4.x HTML5 export (WASM + PCK + loader HTML), served behind nginx.
- Networking:
  - Option A (default): Maintain Socket.IO semantics via the existing godot/bridge (Socket.IO <-> WebSocket adapter), minimizing backend change.
  - Option B (stretch): Migrate backend to raw WebSockets compatible with Godot’s built-in WebSocketClient; remove Socket.IO dependency.
- Delivery:
  - CI builds Godot HTML5 export deterministically.
  - Docker image serves the export via nginx with proper caching and compression.
  - K8s manifests route a subset of traffic to Godot client (canary), with quick rollback.
- Observability: Enhanced logs/metrics during cutover; smoke tests and synthetic checks.

---

## Architecture choices

- Godot target: HTML5 (WASM) export for browser delivery.
- Compatibility strategy:
  - Short-term: Keep server contract via bridge (least risk).
  - Mid-term: Evaluate replacing Socket.IO in backend with pure WebSocket if desired (optional improvement).
- Serving strategy:
  - Keep static serving via nginx (same pattern as web/), but serve Godot export artifacts.
- Feature parity baseline:
  - Input, camera, physics, visuals parity validated via scripted test plan (see QA section).

---

## Migration roadmap

Phase 0 — Preparation
- Freeze high-churn UI features in three.js client.
- Capture existing message contracts between client and server:
  - Inventory of event names, payload shapes, and flows (join, lobby, match start, world updates, score, disconnect, error).
  - Store in contracts doc: docs/contracts-realtime.md (new).
- Confirm bridge strategy (Option A) for initial rollout.
- Validate present godot project builds/runs locally.

Phase 1 — Godot client core
- Implement/verify in Godot:
  - Session flow: lobby -> match -> HUD -> end-state.
  - Net events via bridge: connect, reconnect, heartbeats, room/channel joins, state deltas.
  - Input mapping and deterministic client prediction rules (to parity with three.js UX).
- Align visual assets and rendering decisions (water, particles, models already under godot/assets/).
- Feature flags for client selection (URL param or ingress header for canary).

Phase 2 — Build & packaging
- Create CI steps to:
  - Export Godot HTML5 build headlessly (see Dockerfile example).
  - Package artifacts into nginx image (static site).
- Produce a second frontend deployment (godot-web) alongside existing web (three.js).

Phase 3 — Side-by-side deployment
- Add ingress routing:
  - /v2 -> godot-web (new).
  - / -> existing web (three.js).
- Early testers use /v2 path; collect metrics, error rates, and UX performance.

Phase 4 — Canary rollout
- Shift small percent of “/” traffic to godot-web via ingress annotations or service-weighted routing (cap at e.g. 5–10%).
- Watch telemetry; fix bugs; iterate.

Phase 5 — Cutover & rollback
- Flip default route “/” to godot-web after SLO criteria met for N days.
- Keep legacy web for a defined grace period with a separate path (/legacy).
- Rollback plan: single ingress rule flip, plus tag re-deploy of old image if needed.

Phase 6 — Decommission three.js client
- Remove webpack/bundler from web/ after success period.
- Clean dependencies and reduce image size.
- Archive code in a branch/tag.

---

## Networking compatibility

Short-term (recommended) — Keep backend unchanged
- Keep server/index.js with Socket.IO.
- Use godot/bridge to translate between Godot and Socket.IO:
  - Godot ↔ Bridge: WebSocket (JSON messages).
  - Bridge ↔ Server: Socket.IO (preserves existing events).
- This permits Godot adoption without touching server’s event semantics.

Alternative — Migrate to raw WebSocket (optional)
- Replace Socket.IO with ws or uWebSockets.js on server.
- Update Godot to speak JSON frames directly to server.
- Requires coordinated protocol migration; more moving parts.

Message contract safeguards
- Create and maintain docs/contracts-realtime.md listing:
  - Event names (e.g., join_room, world_update, score_update, ping, error).
  - Payload JSON schema with required/optional fields and enums.
  - Versioning approach (additive changes, server tolerance, client feature flags).
- Add contract tests in server/test/ and a small harness for bridge compliance.

---

## Build, Docker, and CI/CD

Godot HTML5 export (headless)
- Use a containerized Godot export (headless) to produce:
  - index.html, .wasm, .pck (or .zip depending on template).
- Artifacts are static and can be served by nginx.

Example Dockerfile (multi-stage, HTML5):

```
# Stage 1: Build Godot HTML5 export (uses a headless Godot image)
FROM ghcr.io/godotengine/godot:4.3.0-stable-headless as exporter
# If export templates are not preinstalled in this image, install them here:
# RUN mkdir -p /root/.local/share/godot/export_templates/4.3.stable
# COPY export-templates/* /root/.local/share/godot/export_templates/4.3.stable/

WORKDIR /usr/src/godot
COPY godot/ ./

# Export to HTML5 (adjust preset name to match export_presets.cfg)
RUN godot --headless --path ./ --export-release "Web" /tmp/export/web/index.html

# Stage 2: Build runtime image with nginx
FROM nginx:1.25-alpine
RUN apk add --no-cache brotli
COPY --from=exporter /tmp/export/web/ /usr/share/nginx/html/

# Optional: add gzip/brotli, caching headers (via custom nginx.conf)
# COPY deploy/runtime/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
```

Notes:
- Ensure export_presets.cfg contains a “Web” preset with proper paths and compression options.
- Consider enabling brotli/gzip for .wasm/.pck with long-lived caching for immutable filenames.

CI pipeline (high level)
- On push:
  - Lint Godot GDScript (optional), run headless unit tests if any.
  - Build HTML5 export artifact.
  - Build and push the nginx image (e.g., ghcr.io/org/godot-web:SHA).
  - Build/push bridge image if changes detected (godot/bridge).
  - Deploy via kustomize overlays (dev → staging → prod).
  - Run smoke tests: HTTP 200 for index.html, wasm fetch, WS handshake to bridge.

Kubernetes (baseline)
- Services:
  - godot-web (nginx static).
  - godot-bridge (Node adapter service).
  - ws-server (existing Node server).
- Ingress:
  - Path /v2 → godot-web
  - Path / → web (legacy) during canary; later flip default to godot-web.
- Config:
  - WebSocket upgrade routes from godot-web client to godot-bridge, and bridge to ws-server.
  - Ensure CORS/Host, TLS, and large frame limits as required.

---

## Local development

- Current three.js dev:
  - npm run dev (webpack dev server) in web/.

- Godot dev:
  - Use Godot editor for scene editing, scripts in godot/scripts/.
  - Run bridge locally (godot/bridge/run_bridge.sh), pointing to dev ws-server (scripts/dev_start.sh can help).
  - Export HTML5 locally for quick validation:
    - Godot Editor: Project → Export → Web → Export.
    - Or headless: godot --headless --export-release "Web" ./build/web/index.html
  - Serve the exported folder via a simple static server (or Docker compose with nginx).

---

## Feature parity checklist

Gameplay and UX
- Lobby: room discovery/creation, player list, readiness state.
- Match lifecycle: countdown, start, pause/resume, end conditions.
- Controls: input mapping parity and responsiveness.
- HUD: scores, timers, notifications.

Networking
- Connect/reconnect, heartbeats, session resume if supported.
- Message rate and payload sizes; burst handling (backpressure).
- Error handling (server rejection, invalid payloads).

Rendering and performance
- Visual parity for key VFX (water, particles).
- Frame pacing under load; mobile/desktop baseline targets.
- Resource loading (WASM, PCK) caching behavior.

Accessibility and UX polish
- Keyboard/mouse/touch handling.
- Resolution scaling, fullscreen behavior, focus handling.
- Localization hooks (if applicable).

---

## Observability and quality gates

- Logging:
  - Bridge logs request/response metadata (without PII), error rates, reconnect attempts.
  - Nginx access logs for static artifacts (cache hit/miss).

- Metrics:
  - p95/p99 page load (index → first frame), WS connect success, reconnect counts.
  - Error budgets for client JS errors (window.onerror capture, if applicable).

- Synthetic checks:
  - HEAD/GET for index.html and .wasm.
  - WebSocket handshake to bridge and basic message exchange.

- Acceptance criteria for cutover:
  - 7 days stable canary (no Sev-1 incidents).
  - p95 load and reconnect error rates at or better than legacy.
  - QA parity checklist signed off.

---

## Risk assessment and mitigations

- Large .wasm payloads affect first load time
  - Mitigation: Enable brotli/gzip, long cache with content-hashed filenames, preloading hints.
- Socket.IO ↔ WebSocket translation bugs
  - Mitigation: Contract tests, verbose logging gated by env, progressive rollout.
- Browser compatibility
  - Mitigation: Test matrix (Chrome, Firefox, Safari, Edge; Android/iOS recent); polyfills as needed.
- Resource usage in k8s (bridge)
  - Mitigation: Autoscaling and resource limits; load test plan pre-prod.

---

## Decommissioning legacy three.js client

- After stable period:
  - Update ingress to remove /legacy route and retire web (three.js) deployment.
  - Remove web/bundler, webpack-based pipeline, and three.js deps from package.json.
  - Archive the last legacy image/tag and code branch.

---

## Backlog and optional improvements

- Option B protocol: migrate server to raw WebSockets and remove Socket.IO.
- Asset pipeline unification: standardize on glTF and shared import settings across clients.
- E2E test suite (Playwright) for lobby → match flows in HTML5 export.
- Sentry or similar client-side error reporting on Godot HTML5.

---

## Concrete actions summary

Short-term
- Confirm bridge approach (Option A).
- Add contracts doc for events/payloads.
- Ensure Godot HTML5 export builds headlessly in CI.
- Add new Dockerfile for godot-web image; deploy alongside legacy.
- Ingress: expose /v2 to godot-web; testers validate.
- Canary shift 5–10%, monitor; fix issues; document.

Cutover
- Flip default “/” to godot-web.
- Keep /legacy for rollback during grace period.

Post-cutover
- Remove three.js stack; simplify pipeline.
- Evaluate Option B protocol simplification.

---

## References (repo paths)

- Godot project: godot/
- Bridge adapter: godot/bridge/
- Backend server: server/
- K8s base manifests: deploy/k8s/base/godot, deploy/k8s/base/godot-bridge, deploy/k8s/base/ws-server
- Legacy web (three.js): web/
