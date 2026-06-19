# 18-Minute Stage Script

Use this as the rehearsal script, not as a teleprompter. The goal is to keep the room moving: play first, prove second, architecture third, then land the reusable AI engineering pattern.

Before walking on stage, run:

```bash
npm run check:conference-demo
npm run check:conference-demo:game
```

Current healthy stage posture:

- Game smoke: `ready`
- AI preflight: `ready_with_caveats`
- Latest deployed proof: commit `71dd1f1`, deployment `prod-conference-demo-71dd1f1`, server image `0.0.28`
- Latest mobile smoke proof: `RUNNING`, joystick visible, safe nearest-trash buffer, boat seated at waterline
- Safe caveats: smoke replay/vector rows may be empty, and current commentary metadata can report `canvas:null`, `in_db_agent:null`, and `runtime_mode=behavior-adapter`
- Safe claim: live game, OKE deployment, PAF health, Oracle AI Database evidence path, Select AI/in-db agent configuration, model-router trace persistence, mobile playability, and grounded commentary constraints
- Gated claim: two live private upstream LLM runtimes

## 0:00-0:45 - Limbic Opening

**Screen:** Game URL or QR.

**Say:**

> Before I show you architecture, I want you to create the data.
>
> Open the game on your phone. Move the boat, collect trash, grab a powerup, and try not to cross another player's trail.
>
> In two minutes, this room will create a live event stream: coordinates, collisions, powerups, freezes, score changes, and replay moments.
>
> Then we will ask an agent to comment on what happened.
>
> The important bit: the model is not guessing. SQL decides what happened. The model decides how to say it.

**Operator note:** Stop talking. Let the game do the emotional work. The first minute is not a database lecture. It is the limbic opening: people should feel the game before they inspect the system.

## 0:45-2:30 - Audience Play

**Screen:** Live game.

**Say lightly while people join:**

> This is the only part of the talk where chaos is productive.
>
> If you collect a powerup, that becomes an event. If you cross a trail and someone freezes, that becomes an event. If nothing dramatic happens, I have a seeded smoke session, because demos deserve a backup plan.

**What to watch:**

- at least one visible player moving
- mobile joystick visible
- item counts healthy
- no one stuck on the lobby screen

**If Wi-Fi is slow:**

> No drama. The pattern does not depend on the room behaving perfectly. We will use the smoke session and still prove the full path.

## 2:30-4:00 - Reveal The Telemetry

**Screen:** Event timeline slide.

**Say:**

> Now strip away the nice water and the boats.
>
> What remains is an event ledger: `game_started`, `position_sample`, `trash_collected`, `powerup_collected`, `trail_crossed`, `player_frozen`, and `game_over`.
>
> Each event has the boring details that make AI useful: session, room, player, timestamp, score, coordinates, related player or item IDs, and JSON metadata.
>
> That is the first serious point. The AI layer does not start with a prompt. It starts with operational truth.

**Transition:**

> The game is the wrapper. The event stream is the product.

## 4:00-5:45 - Oracle AI Database As Match Intelligence

**Screen:** SQL / JSON / Graph / Vector lenses.

**Say:**

> A lot of AI demos quietly split the world into pieces: logs in one place, vectors somewhere else, app state somewhere else, traces in another tool, and then a prompt trying to stitch it all back together.
>
> That is friction. And under pressure, friction wins.
>
> Here the match intelligence sits in Oracle AI Database. SQL decides the facts. JSON carries flexible event and replay payloads. Graph explains relationships like who crossed whose trail. Vector memory is available for similar prior moments and player style when history exists.
>
> This is why I like this demo for AI engineers. It is playful, but it teaches a grown-up architecture lesson: memory is not just a vector table. Memory is persistence, scoping, retrieval, provenance, deletion, trace, and governance.

**Phrase to land:**

> Facts in memory. Behavior in weights.

## 5:45-7:30 - Live Context And Commentary Proof

**Screen:** Terminal next to browser.

**Action:**

```bash
npm run check:conference-demo
```

**Say while it runs:**

> Look at the receipt, not just the sentence.
>
> `game-url` proves the app is alive. `paf-health` proves the deployed PAF service is wired to Oracle, GenAI, Canvas config, Select AI, and the in-db agent path. `match-context` proves the SQL-backed evidence package. `commentary` proves bounded output with source metadata.
>
> The warnings are useful. They stop me from saying something the runtime did not prove.

**When the receipt shows `ready_with_caveats`:**

> This is exactly the engineering posture I want. The system says: the game is live, the evidence path is live, commentary is bounded and traceable, but this exact smoke line did not come from Canvas and the routes still report adapter mode.
>
> That is not a failure. That is the harness refusing to let the stage story outrun the metadata.

**Optional line if the room is technical:**

> The receipts are part of the demo. A modern AI app should tell you what it knows, what it inferred, and which path produced the answer.

**If you want raw proof:**

```bash
curl -sS -X POST http://130.162.174.167/paf/api/context \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Then:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

**Read aloud only the useful fields:**

- `source`
- `fallback_source`
- `model_route.runtime_mode`
- `canvas`
- `in_db_agent`
- `summary.powerups`
- `trail_crosses`
- `freezes`
- coordinates

## 7:30-9:30 - Architecture

**Screen:** Runtime path slide.

**Say:**

> The useful claim is not "Oracle can host a game." That is true, but too small.
>
> The useful claim is that a modern interactive app can run on Oracle infrastructure and keep its AI layer close to governed operational truth.
>
> Browser 3D and mobile controls create the experience. OKE runs the services. Socket.IO keeps the game live. Coherence handles real-time fanout. Oracle AI Database stores the event truth, replay metadata, graph facts, vector-ready memory, traces, and training examples. Private Agent Factory is deployed with the app and exposes the agent workflow surface.

**Boundary line:**

> Canvas is the business-facing agent surface. The response metadata is the authority for which path produced a specific line.

**Do not over-explain:** Kubernetes object names. Keep the architecture moving.

## 9:30-12:00 - Agent = Model + Harness

**Screen:** Agent = Model + Harness slide.

**Say:**

> Modern AI apps are not one giant prompt.
>
> They are live systems with memory, tools, traces, policy, and a model inside a harness.
>
> The model emits tokens. The harness owns the work: retrieval, SQL, tool dispatch, identity, budgets, safety, fallback, trace persistence, and the connection back into the live system.
>
> In this demo, the harness reads Oracle AI Database, builds a bounded evidence package, routes through Select AI, an in-database agent, Canvas when selected, model adapters, or deterministic SQL fallback, then broadcasts only the final safe line back into the game.

**Practical AI engineer translation:**

> If evidence is missing, the commentator should not invent it. If a runtime path is not proven, the metadata should show that. If a layer is slow, the harness should degrade gracefully.

## 12:00-14:30 - Harness Patterns AI Engineers Can Reuse

**Screen:** Game demo to enterprise mapping.

**Say:**

> Replace game events with business events.
>
> Replace replay clips with media evidence, ticket history, transaction snapshots, or operational logs.
>
> Keep the pattern: capture real events, store them where governance lives, retrieve context deliberately, and let the model phrase inside a bounded loop.
>
> For gaming, this becomes live commentary, instant replay captions, post-match recaps, player memory, and highlight search.
>
> For enterprise apps, it is the same shape: operational events, governed context, agent memory, deterministic tools, and traceable output.

**Line to repeat:**

> Telemetry explains what happened. Replay shows it. Oracle AI Database connects both.

## 14:30-16:30 - Notebook CTAs

**Screen:** Three notebook cards.

**Say:**

> The game is the front door. The notebooks are the developer path.
>
> The enterprise data-agent notebook is the harness lesson: tools, retrieval, budgets, tracing, and deterministic work around the model.
>
> The memory and context engineering notebook is the memory lesson: what to keep, what to retrieve, what to compress, and what to discard.
>
> The long-conversation memory notebook is the production lesson: scoped retrieval, durable memory, and continuity across sessions.
>
> A vector database is not a memory system. A bigger context window is not memory either. Memory becomes architecture when you need persistence, user scoping, provenance, deletion, and governance.

**CTA:**

> Play the demo. Inspect the SQL. Run the notebooks. Adapt the harness.

## 16:30-18:00 - Close

**Screen:** Capture -> Ground -> Govern -> Act.

**Say:**

> The game is the wrapper. The pattern is the point.
>
> Start with real events. Pair them with replay evidence. Store both where governance already lives. Retrieve context deliberately. Let Canvas shape the agent experience. Keep the harness responsible for truth, tools, policy, memory, and the live-system connection.
>
> That is the modern view of Oracle AI Database I want AI engineers to see: not a database bolted onto an AI story, but the place where operational truth, memory, retrieval, graph, JSON, traces, and model behavior can work together.
>
> SQL decides what happened. The model decides how to say it. The harness decides whether it is allowed to say it.

**Final line:**

> Ship the proof, then amplify it.

## Timing Rescue

If audience play runs long:

- skip detailed deployment explanation
- keep `/paf/api/context`
- keep `/paf/api/commentary`
- keep `Agent = Model + Harness`
- compress notebooks into one CTA line

If the live game misbehaves:

```bash
npm run check:conference-demo
```

Say:

> I have a smoke session because the pattern matters more than Wi-Fi bravery. This still proves the event ledger, Oracle AI Database context, commentary guardrails, and runtime metadata.

If someone asks whether Canvas produced the line:

> For this exact call, the metadata is the source of truth. Canvas is configured. If `canvas` is null, I do not claim Canvas generated that line. That is how the harness earns trust.

If someone asks about two LLMs:

> Not claiming that yet. The adapter handoff is live. The strict upstream runtime gate is the proof for two live private LLMs, and it is intentionally still gated until metadata says `runtime_mode=upstream-llm`.
