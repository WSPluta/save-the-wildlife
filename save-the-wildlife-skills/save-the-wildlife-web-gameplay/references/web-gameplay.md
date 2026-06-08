# Save The Wildlife Web Gameplay Reference

Grounded in:

- `web/package.json`
- `web/src/script.js`
- `web/src/lobby.js`
- `web/src/commsWorker.js`
- `web/src/objectPool.js`
- `web/src/spatialOctree.js`
- `web/src/assets.js`
- `web/src/style.css`
- `web/bundler/webpack.*.js`

## Scope

Use for Three.js gameplay, webpack bundling, browser UI flow, and client-side multiplayer state.

## Current Stack

- Three.js
- Socket.IO client
- webpack dev and prod builds
- Vitest for unit tests

## Rules

- Keep browser and server event contracts aligned.
- If a new gameplay mechanic affects world objects, check both render logic and object lifecycle.
- Be careful with performance-sensitive code such as object reuse, worker messaging, and spatial indexing.
- Preserve the browser entry points and webpack assumptions unless the task explicitly needs build-system changes.

## Validation Paths

- `npm --prefix web run test:unit`
- `npm --prefix web run build`
- `npm --prefix web run dev`
- `node scripts/dev_cycle_check.mjs` for broader repo-integrated checks when needed

## Typical Change Patterns

- New visual element: update assets, render path, and any networked state mapping.
- New lobby or player-state field: update browser handling and server event payloads together.
- Performance fix: confirm object pools, workers, or spatial structures still preserve behavior.
