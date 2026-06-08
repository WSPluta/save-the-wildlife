---
name: save-the-wildlife-realtime-server
description: Use when editing the Save The Wildlife Node.js realtime game server, including Socket.IO events, room state, object creation, Redis or Coherence backend behavior, Pino logging, health and metrics, and multiplayer game rules.
---

# Save The Wildlife Realtime Server

Use this skill for `server/` changes and for gameplay features where the server is the source of truth.

## Read First

Read `references/realtime-server.md` before changing events, room flow, object state, or backend synchronization logic.

## Workflow

1. Map the event or state transition before editing.
2. Preserve clear ownership of room state and object lifecycle on the server.
3. Keep distributed backend toggles explicit and compatible with local development.
4. Use structured logging and avoid noisy, low-signal logs in hot paths.
5. Validate with unit tests first, then with a browser or scripted multiplayer loop if behavior changed.

## Pairing

- Pair with `../save-the-wildlife-web-gameplay/SKILL.md` for client-visible gameplay changes.
- Pair with `../save-the-wildlife-spring-services/SKILL.md` when score or replay persistence is affected.
