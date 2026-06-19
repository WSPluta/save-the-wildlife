# Stage Console Card

Use this as the one-page operator card while presenting. It is designed for the messy reality of a live room: phones, Wi-Fi, one browser window, one terminal, and AI engineers who will ask what is actually proven.

For full rehearsal, use [18-minute-stage-script.md](18-minute-stage-script.md). This card is the short stage-side version.
For final go/no-go, use [conference-readiness-scorecard.md](conference-readiness-scorecard.md).
For the current runtime deployment, image tags, and proof posture, use [current-proof-snapshot.md](current-proof-snapshot.md).
For the technical proof ladder, use [ai-engineer-presenter-card.md](ai-engineer-presenter-card.md).
For challenge handling, use [claim-ledger.md](claim-ledger.md).
For deeper technical questions, use [ai-engineer-qa.md](ai-engineer-qa.md).

## Screen Setup

Keep three things ready:

1. Browser tab: [stage-entry.html](stage-entry.html) for audience join, then `http://130.162.174.167/`
2. Terminal tab: live proof commands below
3. Optional browser tab: `https://145.241.196.162:8080/agentFactory/`

The game is the emotional entry point. The terminal is the proof. Canvas is the business-facing surface. Do not make Canvas carry the whole engineering argument.

## Current Verified Posture

Use these as the latest receipts, not as promises about future runs:

- Public game: `http://130.162.174.167/` returns `200 OK`.
- Latest runtime app proof: commit `307cc06`, deployment `stwl-deploy-codex-307cc06`, `web:0.0.22`, `ws-server:0.0.31`, `private-agent-factory:0.0.4`.
- Generated stage brief: `.codex_tmp/conference-stage-brief/latest.md` from `npm run check:conference-demo:stage`.
- Public game smoke: use `.codex_tmp/conference-stage-brief/latest.md` as the authority.
- Public mobile smoke: `RUNNING`, joystick visible, safe nearest-trash buffer, boat seated at the waterline.
- Public desktop smoke: `RUNNING`, wake ripples visible, healthy item counts, boat seated at the waterline.
- Conference preflight: `ready_with_caveats`.
- PAF health: Oracle, GenAI, Canvas, Select AI, in-db agent, graph/replay/vector retrieval, and model router configured.
- Current caveats: smoke replay/vector rows are empty; the exact smoke commentary line reports `canvas:null`, `in_db_agent:null`, and behavior-adapter model runtime.

Stage wording:

> The stage brief is the authority. Transport can be green while visual proof still needs a normal browser. That is the posture we want for engineers: proof first, claim second.

## Opening Move

Say:

> Before I show you architecture, I want you to create the data.
>
> Open the game on your phone. Move the boat, grab a powerup, and if you cross another player's trail, someone may get frozen.
>
> In two minutes we will have coordinates, collisions, powerups, freeze events, and replay moments. Then we will ask an agent to comment on what happened.
>
> The important bit: the model is not guessing. SQL decides what happened. The model decides how to say it.

Then stop talking for a moment. Let people play.

## Five-Minute Preflight

Run:

```bash
npm run check:conference-demo
npm run check:conference-demo:transport
npm run check:conference-demo:game
```

Expected:

```text
PASS game-url
PASS paf-health
WARN match-context
WARN commentary
PASS model-proof-bundle
verdict=ready_with_caveats
summary=.codex_tmp/conference-preflight/latest.md
PASS http-game-url
PASS socket-room-lifecycle
summary=.codex_tmp/conference-transport-smoke/latest.md
PASS mobile-gameplay
PASS desktop-gameplay
summary=.codex_tmp/conference-game-smoke/latest.md
```

`ready_with_caveats` is expected while the smoke response has no replay clips/vector memories and still reports `runtime_mode=behavior-adapter`. That is not a demo failure. It is the honest presenter boundary.

The game smoke is the playable-experience receipt. It checks public mobile joystick visibility, `RUNNING` state, healthy item counts, boat-waterline contact, and desktop wake/ripple movement.
When the game smoke passes it also preserves `.codex_tmp/conference-game-smoke/last-ready.md`.
If a sandboxed shell cannot launch Chromium, the generated stage brief will call that out as a local proof-browser blocker rather than silently overwriting good game evidence.
The transport smoke is the browser-free receipt. It proves the public endpoint, Socket.IO connection, presenter start, countdown-to-running lifecycle, item payloads, and presenter end.

If you want to show the raw live probes, run:

```bash
curl -sSI http://130.162.174.167/
curl -sS http://130.162.174.167/paf/healthz
npm run check:model-ai-demo:proof
```

Expected:

```text
HTTP/1.1 200 OK
adapter_verdict=ready_with_upstream_llm_blocker
strict_verdict=failed
proof_bundle=.codex_tmp/model-ai-readiness/proof-bundle.md
```

What to say:

> This is the honest receipt. The app is live, PAF is live, Oracle AI Database is wired, the adapter-mode proof is ready, and strict upstream mode is still blocked until the private routes report real upstream LLM runtime.

## Live Context Proof

Run:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/context \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Current healthy reading:

- `source` is `oracle-match-intelligence`
- `warning` is `null`
- `summary.player_name` is `Ada`
- `summary.score` is `42`
- `summary.powerups.powerup_shield` is `1`
- `summary.trail_crosses` is `1`
- `summary.freezes` is `1`
- `json_events` includes `game_started`, `powerup_collected`, `trail_crossed`, `player_frozen`, `game_over`
- `graph_facts` includes powerup, trail, and freeze relationships
- `replay_clips` may be empty for the smoke session
- `vector_memories` may be empty for the smoke session

What to say:

> This is the match intelligence layer. The SQL ledger gives us the facts. JSON gives us flexible event and replay payloads. Graph explains relationships like who crossed whose trail. Vector memory is available when similar moments exist. The model does not get raw, unbounded video. It gets an evidence package.

## Commentary Proof

Run:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Current healthy reading:

- `ok` is `true`
- `warning` is `null`
- `commentary` is under 200 characters
- `source` is currently `oci-base`
- `fallback_source` is currently `oracle-sql`
- `route_mode` is `shadow`
- `primary_provider` is `oci-base`
- `candidate_provider` is `oci-fine-tuned`
- `runtime_mode` inside `model_route.primary` and `model_route.candidate` is currently `behavior-adapter`
- `canvas` is currently `null` for this smoke response
- `in_db_agent` is currently `null` for this smoke response
- `trace_persisted` is `true`

What to say:

> This response is deliberately short and stage-safe. The metadata matters as much as the sentence. Today this smoke response is coming through the model-router adapter with SQL fallback evidence, not a proven Canvas-generated line. Canvas is configured, but the response metadata is the authority for this exact call.

Then land the engineering point:

> That is the harness doing its job. It retrieves evidence, controls the output, records the trace, and refuses to let the talk track outrun the runtime proof.

## Model Proof

Open `.codex_tmp/model-ai-readiness/proof-bundle.md` or use the generated console output.

Say:

> Tier 1000 proves the harness: 1000 joins, 1000 score rows, 1000 commentary responses, zero duplicate commentary, and a bounded latency profile.
>
> `upstream formats openai:2` proves the private handoff contract.
>
> It does not prove two live private LLM runtimes. That claim waits until strict upstream mode passes.

This is the trust-building moment. Do not soften it.

## Architecture Beat

Use this after the proof, not before:

> The useful claim is not "Oracle can host a game." The useful claim is that a modern interactive app can run on Oracle and keep its AI layer close to governed operational truth.
>
> Browser 3D and mobile controls create the experience. OKE, Socket.IO, and Coherence keep the game live. Oracle AI Database holds the facts, JSON, graph relationships, replay metadata, vector-ready memory, traces, and training examples. PAF and Canvas shape the agent workflow. The harness keeps it grounded.

## The Phrase To Repeat

Use this three times:

> Modern AI apps are not one giant prompt. They are live systems with memory, tools, traces, policy, and a model inside a harness.

## If Something Goes Wrong

If the room is quiet:

> I seeded a smoke session so we can prove the full path even if Wi-Fi is shy.

If Canvas is slow:

> Canvas is the business-facing agent surface. The harness is designed to survive a slow layer and fall back through in-database agents, Select AI, model-router adapters, or deterministic SQL.

If someone asks whether the model watched the game:

> No. And that is the point. Telemetry explains what happened. Replay shows it. Oracle AI Database connects both. The model sees bounded evidence and clip pointers, not raw unbounded footage.

If someone challenges the strict gate:

> Good. That is exactly the engineering posture. The demo proves the harness today and keeps the live-private-LLM claim gated until runtime metadata proves it.

## Close

Say:

> The game is the wrapper. The pattern is the point.
>
> Start with real events. Store them where governance lives. Retrieve context deliberately. Let Canvas shape the agent experience. Keep the harness responsible for truth, tools, policy, memory, and the live-system connection.
>
> That is how you build AI apps people can play with, inspect, trust, and adapt.
