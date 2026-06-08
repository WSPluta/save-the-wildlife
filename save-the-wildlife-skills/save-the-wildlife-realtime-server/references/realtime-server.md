# Save The Wildlife Realtime Server Reference

Grounded in:

- `server/package.json`
- `server/index.js`
- `server/server.js`
- `server/lib/gameLogic.js`
- `server/score.js`
- `server/object-pool.js`
- `server/metrics.js`
- `server/test/gameLogic.test.js`

## Current Stack

- Node.js ESM
- Express
- Socket.IO
- Redis adapter
- Oracle Coherence client
- Pino and pino-http
- Prometheus client metrics

## Rules

- Keep gameplay authority on the server for shared state.
- When adding objects or mechanics, update creation, lifecycle, collision or scoring logic coherently.
- Treat event names and payloads as contracts. Search all emitters and handlers before changing them.
- Maintain safe handling for Redis and Coherence modes.
- Keep health and metrics behavior intact when changing startup or shutdown paths.

## Validation Paths

- `npm --prefix server run test:unit`
- `node --check server/server.js`
- local stack validation with `scripts/dev_start.sh` or narrower startup commands
- browser or scripted multiplayer validation when the gameplay contract changes

## Typical Change Patterns

- New event: update handlers, emits, room flow, and browser consumers together.
- New gameplay object: update server creation and browser rendering together.
- Backend mode change: validate both default local mode and the targeted distributed mode.
