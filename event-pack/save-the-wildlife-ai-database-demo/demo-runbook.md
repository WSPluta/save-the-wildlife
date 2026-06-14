# Demo Runbook

## Demo Message To Land

Use this as the crisp framing before the architecture slide:

> In some cases, AI engineers should let business users build the agent experience in Canvas. The engineering job is to add the harness: connect that Canvas agent to live systems, SQL evidence, deterministic tools, memory, identity, tracing, and policy. In this demo, the harness is the endpoint service connected to the live 3D game. It turns SQL gameplay telemetry into bounded natural-language commentary and broadcasts the result back into the experience.

## Preflight Five Minutes Before

Run:

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
  - `"source": "paf-canvas"`
  - `"fallback_source": "select-ai"`
  - `"warning": null`

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

> This line is short because the agent has a policy. It mentions a shield, a trail crossing, a freeze, and coordinates because those were in SQL. Canvas is shaping the final line, but the harness decides what evidence exists and what can be said. If the event is not in the database, the runtime path should not invent it.

For replay-caption proof when a replay document exists:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","output_format":"replay_caption","max_chars":200}'
```

Talk track:

> A production gaming system would pair this with object-storage video clips. In the demo, the browser sends JSON replay clips around key moments. The replay caption should only mention clip evidence when that manifest exists.

## Model AI Proof Path

Run the presenter-friendly readiness receipt:

```bash
npm run check:model-ai-demo
```

Expected:

- `verdict=ready_with_upstream_llm_blocker`
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
npm run check:model-ai-demo -- --require-upstream-llm
```

Expected today:

- `verdict=failed`
- failure reason includes `runtime_mode=behavior-adapter`

Talk track:

> The tier-1000 canary proves the harness, Oracle AI Database evidence path, PAF route, eval metadata, and score-row proof. The OpenAI-compatible adapter handoff proves both private routes can carry trace IDs and evidence references to upstream model calls. It does not yet prove two live LLMs. That claim only becomes valid when both routes report `runtime_mode=upstream-llm` and the strict canary passes.

## What The Runtime Actually Does

1. Reads `STWL_GAME_EVENTS`.
2. Builds a per-session summary with SQL in `STWL_COMMENTARY_PKG`.
3. Reads JSON event documents, graph facts, replay clip manifests, and vector-ready memories when available.
4. Tries in-database agent team via `DBMS_CLOUD_AI_AGENT.RUN_TEAM`.
5. Falls back to Select AI via `DBMS_CLOUD_AI.GENERATE`.
6. Falls back to deterministic SQL text if generation is unavailable.
7. Sends the bounded evidence package into the published PAF Canvas agent for final phrasing.
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

> The harness is designed not to collapse when one layer is slow. It can use PAF Canvas, Select AI, or deterministic SQL commentary. The source of truth stays the database, and the live game connection remains owned by the harness.

## If The Game Is Unavailable

Use the architecture and API proof:

1. Show `curl -sS http://130.162.174.167/paf/healthz`.
2. Show the commentary API response.
3. Move to Slide 7 faster: Agent = Model + Harness.

## Do Not Say

- Do not say the LLM "watched" the game.
- Do not say Select AI is blindly generating SQL for the runtime path.
- Do not say PAF is an external manual dependency.
- Do not imply Canvas replaces the harness. Canvas is where the agent experience is assembled; the harness keeps it connected and governed.
- Do not describe generic score commentary. The differentiator is mechanics-aware commentary grounded in SQL events.
- Do not say the model watched raw footage. The production pattern is event-aligned clip manifests plus governed telemetry.
- Do not say two live LLMs are running until the strict upstream readiness gate passes.
