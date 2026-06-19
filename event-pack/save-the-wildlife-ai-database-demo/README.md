# Save the Wildlife Oracle AI Database Demo Event Pack

This pack is the source-of-truth for an 18-minute AI developer presentation and a demo-scale gaming industry template:

**A live multiplayer game creates real telemetry and replay clips. Oracle AI Database turns that evidence into governed match intelligence. Oracle Private Agent Factory, Select AI, and the deployed harness turn it into live commentary, replay captions, post-match recap, and a natural path toward production gaming workflows.**

## Audience Promise

By the end, AI developers should understand four things:

1. A good game AI demo starts from real gameplay events and replay evidence, not generic prompts.
2. Oracle AI Database can be the grounded match-intelligence layer for SQL facts, JSON clips, graph relationships, vector memory, and deterministic context.
3. Oracle Private Agent Factory Canvas lets business users shape the agent experience while AI engineers own the harness that connects it to governed data and live systems.
4. The durable pattern is **Agent = Model + Harness**: the model writes tokens; the harness owns memory, tools, SQL, replay pointers, identity, budgets, traces, safety, and broadcast back into the app.

## Live URLs

- Game: `http://130.162.174.167/`
- PAF health: `http://130.162.174.167/paf/healthz`
- PAF commentary API: `http://130.162.174.167/paf/api/commentary`
- PAF match context API: `http://130.162.174.167/paf/api/context`
- PAF Canvas UI: `https://145.241.196.162:8080/agentFactory/`

## Pack Contents

- [run-of-show.md](run-of-show.md): minute-by-minute talk flow.
- [18-minute-stage-script.md](18-minute-stage-script.md): read-aloud rehearsal script with stage actions, proof boundaries, and timing rescue.
- [architecture.md](architecture.md): current post-Redis runtime topology and commentary sequence.
- [slide-outline.md](slide-outline.md): 10-slide deck spine with visual direction and speaker notes.
- [demo-runbook.md](demo-runbook.md): live commands, smoke checks, fallback path, and recovery cues.
- [stage-console.md](stage-console.md): one-page operator card for the browser, terminal proof, source metadata, and fallback lines.
- [ai-engineer-presenter-card.md](ai-engineer-presenter-card.md): limbic opening, AI engineer proof ladder, and stage-ready language.
- [speaker-cards.md](speaker-cards.md): short talk tracks, transitions, and objection handling.
- [notebook-cta-map.md](notebook-cta-map.md): how the three notebooks become CTAs and follow-up learning paths.
- [recording/](recording/): 7:30 rehearsal recording kit with source-backed slides, script, subtitles, and MP4 builder.

## One-Sentence Version

We let the audience generate gameplay telemetry and replay clips on mobile, store the evidence in Oracle AI Database, retrieve SQL/JSON/graph/vector context, route bounded evidence through the deployed Private Agent Factory harness, and use the result to teach live match intelligence as a modern agent pattern. Canvas is the business-facing agent surface; the response metadata is the authority for which path produced a specific line.

## Three-Minute Version

This is not a score-only game demo. The game emits a structured event timeline: `game_started`, `position_sample`, `trash_collected`, `marine_hit`, `powerup_collected`, `trail_crossed`, `player_frozen`, and `game_over`.

Those events land in Oracle AI Database with session, room, player, time, score, coordinates, related player/item IDs, and JSON metadata. Replay clips are captured around key moments and stored as JSON clip payloads plus a clip manifest. The match-intelligence path reads SQL-backed history, graph facts, replay clip metadata, and vector-ready memory, then the deployed Private Agent Factory harness produces conference-safe outputs such as `live_line`, `replay_caption`, `post_match_recap`, and `clip_title` through the configured path: Canvas, Select AI, in-database agent, model-router adapter, or deterministic SQL fallback.

The larger lesson is Canvas plus harness. Canvas is where business users can shape the agent language and workflow. The harness decides what data is retrieved, which tools are exposed, how memory is scoped, how large outputs are offloaded, how identities are enforced, how the trace can be audited, and how grounded commentary is broadcast back into the live game.

## Proof Points To Show

- Latest deployed commit: `71dd1f1`
- Latest deployment receipt: `prod-conference-demo-71dd1f1`
- Current public game smoke: `ready`
- Current public conference preflight: `ready_with_caveats`
- One-command preflight:
  - `npm run check:conference-demo`
  - receipt: `.codex_tmp/conference-preflight/latest.md`
- Playable game smoke:
  - `npm run check:conference-demo:game`
  - receipt: `.codex_tmp/conference-game-smoke/latest.md`
- The game works on mobile and desktop.
- Mobile proof now includes joystick visibility, `RUNNING` state, healthy item counts, boat-waterline contact, and a safe opening spawn buffer.
- PAF health reports Oracle, GenAI, Canvas, in-db agent, and Select AI configured.
- PAF context reports SQL/JSON/graph/vector/replay evidence counts.
- Commentary API returns `warning: null` and source metadata. In the current no-spend proof, expect `source: "oci-base"` with `fallback_source: "oracle-sql"` and `runtime_mode: "behavior-adapter"`; only say Canvas produced a line when the response's `canvas` or `source` fields prove it.
- The endpoint harness remains the connection between Canvas, Oracle AI Database, Select AI or in-database agents, and the live 3D experience.
- The summary includes real game mechanics: powerups, trail crossings, freeze events, coordinates, and prior history when present.
- Replay captions only mention clip/timecode evidence when a replay document exists.
- The runtime path is deterministic around SQL summaries, with bounded LLM phrasing.

## Brand Language

Use **Oracle AI Database** in slides and spoken narrative. Use **Oracle Autonomous Database** only when naming the deployed cloud database service. Avoid making version names the primary product label.
