# Save The Wildlife Core Guardrails Reference

Converted from:

- `.clinerules/save-the-wildlife.md`
- `.clinerules/save-the-wildlife-updated.md`

Grounded in the current repository layout:

- `web/`
- `server/`
- `score/`
- `replay/`
- `scripts/`
- `deploy/`
- `livelabs/`

## Project Structure

- New services should live at the repo root and follow existing service patterns.
- Frontend gameplay logic belongs in `web/src/`.
- Realtime gameplay authority belongs in `server/`.
- Spring services belong in `score/` or `replay/`.
- Infra and runtime rollout assets belong in `deploy/`.
- Automation belongs in `scripts/`.

## Cross-Service Coordination

When adding a feature, map all coupled surfaces:

- browser rendering and input handling
- server event handling and game state
- score or replay APIs if persistence is involved
- deployment manifests if runtime config changes
- docs or workshop steps if operators or learners must do something new

## Version And Dependency Discipline

- Check whether the affected service version should move.
- Use repo conventions for dependency additions.
- Keep Three.js, Socket.IO, Spring Boot, and Oracle JDBC families compatible with existing code.

## Backend Toggles

- `ENABLE_REDIS_BACKEND`
- `ENABLE_COHERENCE_BACKEND`

Treat changes to backend selection or distributed state handling as behavior changes that need explicit validation.

## Local Validation

- `web`: build or dev server checks
- `server`: unit tests and syntax checks
- `score` or `replay`: Gradle tests or boot verification
- `deploy`: validate generated manifests or plans
- `scripts`: run the affected script path with safe arguments or dry-run behavior when available

## Anti-Patterns

- Updating only one side of a Socket.IO contract
- Changing gameplay semantics without validating browser behavior
- Bypassing scripts with manual release or deploy flows
- Sneaking infra or config changes into an unrelated gameplay patch
