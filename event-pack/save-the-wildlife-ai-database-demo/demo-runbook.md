# Demo Runbook

## Demo Message To Land

Use this as the crisp framing before the architecture slide:

> In some cases, AI engineers should let business users shape the agent experience in Canvas. The engineering job is to add the harness: connect that experience to live systems, SQL evidence, deterministic tools, memory, identity, tracing, fallback, and policy. In this demo, the harness is the endpoint service connected to the live 3D game. It turns SQL gameplay telemetry into bounded natural-language commentary, records which path produced the line, and broadcasts the result back into the experience.

For the shortest stage-ready operator view, use
[stage-console.md](stage-console.md). It is the browser-plus-terminal card for the live room.

For the proof ladder to use when AI engineers challenge the architecture, keep
[ai-engineer-presenter-card.md](ai-engineer-presenter-card.md) open. It maps each live receipt to what it proves and what it does not prove yet.

## Current Verified Posture

Use these as the latest receipts before walking on stage:

- Public game endpoint: `http://130.162.174.167/`
- Deployed proof: commit `71dd1f1`, deployment `prod-conference-demo-71dd1f1`
- Public game smoke: `ready`
- Mobile proof: `RUNNING`, joystick visible, safe nearest-trash buffer, boat seated at waterline
- Public conference preflight: `ready_with_caveats`
- PAF health: Oracle, GenAI, Canvas, Select AI, in-db agent, graph/replay/vector retrieval, and model router configured
- Current claim boundary: smoke replay/vector rows may be empty; the exact smoke commentary line can report `canvas:null`, `in_db_agent:null`, and behavior-adapter runtime

Stage line:

> The game path is green. The AI path is green with boundaries. That is how this earns trust with engineers: proof first, claim second.

## Preflight Five Minutes Before

Run:

```bash
npm run check:conference-demo
npm run check:conference-demo:game
```

Healthy presenter result:

- `PASS game-url`
- `PASS paf-health`
- `WARN match-context` is acceptable when the smoke session has no replay clips or vector memories
- `WARN commentary` is acceptable while the response metadata reports `canvas:null`, `in_db_agent:null`, and `runtime_mode=behavior-adapter`
- `PASS model-proof-bundle`
- final verdict is `ready_with_caveats`
- receipt is `.codex_tmp/conference-preflight/latest.md`
- game smoke final verdict is `ready`
- game smoke receipt is `.codex_tmp/conference-game-smoke/latest.md`

For raw inspection, run:

```bash
curl -sSI http://130.162.174.167/
curl -sS http://130.162.174.167/paf/healthz
curl -sS -X POST http://130.162.174.167/paf/api/context \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Healthy signals:

- Game returns `HTTP/1.1 200 OK`
- PAF health returns `"ok": true`
- PAF health includes:
  - `"oracle_configured": true`
  - `"genai_configured": true`
  - `"canvas_configured": true`
  - `"indb_agent_enabled": true`
  - `"select_ai_auto_init": true`
  - `"select_ai_profile": "STWL_GAMEPLAY_AI"`
- PAF health includes:
  - `"match_intelligence_enabled": true`
  - `"graph_retrieval_enabled": true`
  - `"replay_retrieval_enabled": true`
  - `"vector_retrieval_enabled": true`
- Context returns:
  - `"json_events"` with recorded gameplay rows
  - `"graph_facts"` with player/item/trail/freeze relationships
  - `"capabilities"` showing which evidence lenses were available
- Commentary returns:
  - `"warning": null`
  - `summary` fields that match recorded SQL evidence
  - source metadata such as `source`, `fallback_source`, `model_route`, `canvas`, and `in_db_agent`
  - for the current no-spend proof, `source` may be `"oci-base"` with `fallback_source` `"oracle-sql"` and model-route `runtime_mode` `"behavior-adapter"`

## Live Audience Play

1. Put `http://130.162.174.167/` on screen.
2. Ask 3-5 people to join from phones.
3. Encourage them to collect powerups and cross trails.
4. Narrate the mechanics:
   - `powerup_shield`, `powerup_speed`, `powerup_magnet`, `powerup_freeze`
   - players emit trails
   - crossing another player's trail can freeze a player
   - the game records coordinates and collisions

## Match Intelligence Proof

Use the context API first:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/context \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Talk track:

> This is the match intelligence layer. SQL says what happened, JSON carries flexible event and replay payloads, graph facts explain relationships, and vector memory can retrieve similar moments. The model sees this evidence, not raw unbounded footage.

## Commentary And Replay Proof

Use the PAF API after gameplay. For a known fallback proof:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Talk track:

> This line is short because the agent has a policy. It mentions a shield, a trail crossing, a freeze, and coordinates because those were in SQL. The metadata tells us which runtime path produced this specific line. Canvas is configured as the agent-building surface, and the harness decides what evidence exists, what path is allowed, and what can be said. If the event is not in the database, the runtime path should not invent it.

For replay-caption proof when a replay document exists:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","output_format":"replay_caption","max_chars":200}'
```

Talk track:

> A production gaming system would pair this with object-storage video clips. In the demo, the browser sends JSON replay clips around key moments. The replay caption should only mention clip evidence when that manifest exists.

## Model AI Proof Path

The fastest conference preflight is:

```bash
npm run check:conference-demo
npm run check:conference-demo:game
```

This wraps the live game URL, PAF health, match context, commentary constraints, and model proof bundle into `.codex_tmp/conference-preflight/latest.md`, then proves public mobile/desktop playability in `.codex_tmp/conference-game-smoke/latest.md`.

Run the full local proof bundle:

```bash
npm run check:model-ai-demo:proof
```

Expected:

- `adapter_verdict=ready_with_upstream_llm_blocker`
- `strict_verdict=failed`
- bundle receipt: `.codex_tmp/model-ai-readiness/proof-bundle.md`

Run the presenter-friendly readiness receipt:

```bash
npm run check:model-ai-demo
```

Expected:

- `verdict=ready_with_upstream_llm_blocker`
- stable receipt: `.codex_tmp/model-ai-readiness/adapter-mode.md`
- private adapter health shows `providers oci-base:1, oci-fine-tuned:1`
- private adapter health shows `upstream formats openai:2`

Then prove the public admin UI:

```bash
curl -sS http://130.162.174.167/admin/ai-learning | \
  rg "Tier 1000 pass|upstream formats openai:2|OpenAI upstream handoff contract|LLM proof gate"
```

Point to these receipts:

- `Tier 1000 pass`: 1000 joins, 1000 score rows, 1000 commentary responses, zero duplicates.
- `upstream formats openai:2`: both private routes expose the OpenAI-compatible evidence handoff.
- `25 live examples`: behavior-only traces are exportable for training.
- `Trainer dry-run`: the QLoRA trainer accepts the redacted dataset shape.
- `Promotion held for upstream GPU LLM runtime`: the system refuses to claim a fine-tuned winner before runtime proof.

Run the strict gate only to show the honest blocker:

```bash
npm run check:model-ai-demo:strict
```

Expected today:

- `verdict=failed`
- stable receipt: `.codex_tmp/model-ai-readiness/strict-upstream.md`
- failure reason includes `runtime_mode=behavior-adapter`

After strict mode, rerun `npm run check:model-ai-demo` so `.codex_tmp/model-ai-readiness/latest.*` returns to the presenter-friendly adapter-mode receipt.

Talk track:

> The tier-1000 canary proves the harness, Oracle AI Database evidence path, PAF route, eval metadata, and score-row proof. The OpenAI-compatible adapter handoff proves both private routes can carry trace IDs and evidence references to upstream model calls. It does not yet prove two live LLMs. That claim only becomes valid when both routes report `runtime_mode=upstream-llm` and the strict canary passes.

## What The Runtime Actually Does

1. Reads `STWL_GAME_EVENTS`.
2. Builds a per-session summary with SQL in `STWL_COMMENTARY_PKG`.
3. Reads JSON event documents, graph facts, replay clip manifests, and vector-ready memories when available.
4. Tries in-database agent team via `DBMS_CLOUD_AI_AGENT.RUN_TEAM`.
5. Falls back to Select AI via `DBMS_CLOUD_AI.GENERATE`.
6. Falls back to deterministic SQL text if generation is unavailable.
7. Routes the bounded evidence package through the configured PAF path: Canvas when selected and proven by metadata, otherwise in-database agent, Select AI, model-router adapter, or SQL fallback.
8. Enforces length and profanity guard.
9. Broadcasts the grounded commentary back into the live game experience.

## Presenter-Facing Select AI Prompts

Use these as spoken examples or SQL worksheet prompts:

```sql
EXEC DBMS_CLOUD_AI.SET_PROFILE('STWL_GAMEPLAY_AI');
SELECT AI NARRATE summarize the latest Save the Wildlife session and mention powerups and freezes;
SELECT AI SHOWSQL which players were frozen most often by crossing another player's trail;
SELECT AI NARRATE explain why the latest replay clip mattered using only recorded telemetry;
SELECT AI SHOWSQL find similar prior match memories for the latest player;
```

## If Live Gameplay Is Quiet

Use the smoke session. Say:

> I seeded a known smoke session so we can prove the full path even if the room is shy or Wi-Fi is slow.

Then run the commentary API command above.

## If PAF Canvas Is Slow

Explain the fallback chain:

> The harness is designed not to collapse when one layer is slow. It can use Canvas when selected, in-database agents, Select AI, model-router adapters, or deterministic SQL commentary. The source of truth stays Oracle AI Database, and the live game connection remains owned by the harness.

## If The Game Is Unavailable

Use the architecture and API proof:

1. Show `curl -sS http://130.162.174.167/paf/healthz`.
2. Show the commentary API response.
3. Move to Slide 7 faster: Agent = Model + Harness.

## Do Not Say

- Do not say the LLM "watched" the game.
- Do not say Select AI is blindly generating SQL for the runtime path.
- Do not say PAF is an external manual dependency.
- Do not imply Canvas replaces the harness. Canvas is where the agent experience is shaped; the harness keeps it connected and governed.
- Do not say Canvas produced a specific line unless the response metadata proves it.
- Do not describe generic score commentary. The differentiator is mechanics-aware commentary grounded in SQL events.
- Do not say the model watched raw footage. The production pattern is event-aligned clip manifests plus governed telemetry.
- Do not say two live LLMs are running until the strict upstream readiness gate passes.
