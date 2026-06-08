---
name: save-the-wildlife-web-gameplay
description: Use when editing the Save The Wildlife Three.js frontend, including gameplay rendering, lobby flow, browser-side multiplayer behavior, webpack configuration, performance-sensitive client code, and browser validation loops.
---

# Save The Wildlife Web Gameplay

Use this skill for `web/` changes.

## Read First

Read `references/web-gameplay.md` before changing gameplay rendering, browser-side networking, or bundle config.

## Workflow

1. Identify the gameplay surface first: rendering, input, lobby, worker, assets, or stylesheet.
2. Trace the corresponding Socket.IO event or state field before changing browser logic.
3. Keep performance-sensitive loops and object management predictable.
4. Validate with the lightest useful browser loop, then use a richer local playtest if behavior changed.
5. Pair with `../save-the-wildlife-realtime-server/SKILL.md` for any event or room-state change.

## Pairing

- Pair with the existing `develop-web-game` skill for local browser test loops and screenshot-backed validation.
