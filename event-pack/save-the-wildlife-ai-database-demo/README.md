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
- [current-proof-snapshot.md](current-proof-snapshot.md): runtime deploy proof, live image tags, green receipts, and gated claims.
- [18-minute-stage-script.md](18-minute-stage-script.md): read-aloud rehearsal script with stage actions, proof boundaries, and timing rescue.
- [architecture.md](architecture.md): current post-Redis runtime topology and commentary sequence.
- [slide-outline.md](slide-outline.md): 10-slide deck spine with visual direction and speaker notes.
- [save-the-wildlife-ai-engineer-demo-deck.pptx](../../outputs/save-the-wildlife-ai-engineer-demo-deck.pptx): editable 10-slide stage deck generated from this event pack.
- [demo-runbook.md](demo-runbook.md): live commands, smoke checks, fallback path, and recovery cues.
- [stage-console.md](stage-console.md): one-page operator card for the browser, terminal proof, source metadata, and fallback lines.
- [ai-engineer-demo-master-card.md](ai-engineer-demo-master-card.md): one rehearsal surface with opening line, proof commands, claim boundaries, failure pivots, and notebook CTAs.
- [manual-visual-proof.md](manual-visual-proof.md): human visual QA checklist when browser automation cannot launch from the current shell.
- [stage-entry.html](stage-entry.html): 16:9 audience-entry slide with game URL, QR code, and opening cue.
- [conference-readiness-scorecard.md](conference-readiness-scorecard.md): final go/no-go scorecard for stage readiness, proof posture, and fallback rules.
- [claim-ledger.md](claim-ledger.md): stage-safe claim matrix that maps every major statement to a receipt and boundary.
- [ai-engineer-qa.md](ai-engineer-qa.md): objection-handling sheet for technical Q&A after the demo lands.
- [ai-engineer-presenter-card.md](ai-engineer-presenter-card.md): limbic opening, AI engineer proof ladder, and stage-ready language.
- [speaker-cards.md](speaker-cards.md): short talk tracks, transitions, and objection handling.
- [notebook-cta-map.md](notebook-cta-map.md): how the three notebooks become CTAs and follow-up learning paths.
- [recording/](recording/): 7:30 rehearsal recording kit with source-backed slides, script, subtitles, and MP4 builder.
- [assets/game-url-qr.svg](assets/game-url-qr.svg) and [assets/game-url-qr.png](assets/game-url-qr.png): QR assets for slides, printouts, or the stage-entry page.

## One-Sentence Version

We let the audience generate gameplay telemetry and replay clips on mobile, store the evidence in Oracle AI Database, retrieve SQL/JSON/graph/vector context, route bounded evidence through the deployed Private Agent Factory harness, and use the result to teach live match intelligence as a modern agent pattern. Canvas is the business-facing agent surface; the response metadata is the authority for which path produced a specific line.

## Three-Minute Version

This is not a score-only game demo. The game emits a structured event timeline: `game_started`, `position_sample`, `trash_collected`, `marine_hit`, `powerup_collected`, `trail_crossed`, `player_frozen`, and `game_over`.

Those events land in Oracle AI Database with session, room, player, time, score, coordinates, related player/item IDs, and JSON metadata. Replay clips are captured around key moments and stored as JSON clip payloads plus a clip manifest. The match-intelligence path reads SQL-backed history, graph facts, replay clip metadata, and vector-ready memory, then the deployed Private Agent Factory harness produces conference-safe outputs such as `live_line`, `replay_caption`, `post_match_recap`, and `clip_title` through the configured path: Canvas, Select AI, in-database agent, model-router adapter, or deterministic SQL fallback.

The larger lesson is Canvas plus harness. Canvas is where business users can shape the agent language and workflow. The harness decides what data is retrieved, which tools are exposed, how memory is scoped, how large outputs are offloaded, how identities are enforced, how the trace can be audited, and how grounded commentary is broadcast back into the live game.

## Proof Points To Show

- Latest runtime-changing deploy commit: `3f26f08`
- Latest runtime deployment receipt: `stwl-deploy-codex-3f26f08`
- Current proof snapshot: [current-proof-snapshot.md](current-proof-snapshot.md)
- One-command stage brief:
  - `npm run check:conference-demo:stage`
  - receipt: `.codex_tmp/conference-stage-brief/latest.md`
- Current public game smoke: use `.codex_tmp/conference-stage-brief/latest.md` as the authority
- Current public conference preflight: `ready_with_caveats`
- One-command preflight:
  - `npm run check:conference-demo`
  - receipt: `.codex_tmp/conference-preflight/latest.md`
- Playable game smoke:
  - `npm run check:conference-demo:game`
  - receipt: `.codex_tmp/conference-game-smoke/latest.md`
  - preserved passing receipt: `.codex_tmp/conference-game-smoke/last-ready.md`
- Browser-free transport smoke:
  - `npm run check:conference-demo:transport`
  - receipt: `.codex_tmp/conference-transport-smoke/latest.md`
- The game works on mobile and desktop when the game smoke is `ready` or [manual-visual-proof.md](manual-visual-proof.md) has been completed from a normal browser.
- Mobile proof should include joystick visibility, `RUNNING` state, healthy item counts, boat-waterline contact, and a safe opening spawn buffer.
- PAF health reports Oracle, GenAI, Canvas, in-db agent, and Select AI configured.
- PAF context reports SQL/JSON/graph/vector/replay evidence counts.
- Commentary API returns `warning: null` and source metadata. In the current no-spend proof, expect `source: "oci-base"` with `fallback_source: "oracle-sql"` and `runtime_mode: "behavior-adapter"`; only say Canvas produced a line when the response's `canvas` or `source` fields prove it.
- The endpoint harness remains the connection between Canvas, Oracle AI Database, Select AI or in-database agents, and the live 3D experience.
- The summary includes real game mechanics: powerups, trail crossings, freeze events, coordinates, and prior history when present.
- Replay captions only mention clip/timecode evidence when a replay document exists.
- The runtime path is deterministic around SQL summaries, with bounded LLM phrasing.

## Brand Language

Use **Oracle AI Database** in slides and spoken narrative. Use **Oracle Autonomous Database** only when naming the deployed cloud database service. Avoid making version names the primary product label.
