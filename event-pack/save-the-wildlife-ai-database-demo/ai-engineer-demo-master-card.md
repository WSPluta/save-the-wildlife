# AI Engineer Demo Master Card

Use this as the one file to keep open during rehearsal. It does not replace the full script; it keeps the live story, proof posture, and rescue lines in one place.

## Current Stage Posture

- Public game: `http://130.162.174.167/`
- PAF Canvas: `https://145.241.196.162:8080/agentFactory/`
- Runtime proof: `3f26f08`, deploy `stwl-deploy-codex-3f26f08`, `web:0.0.23`
- Stage verdict: `go_with_caveats`
- Latest game proof: mobile and desktop `RUNNING`
- Mobile receipt: joystick `134x134`, boat `y=-0.068`, seat depth `0.071`, camera `fov=70`
- AI proof: PAF, Oracle AI Database evidence path, Select AI, in-db agent configuration, model router, trace persistence, and adapter proof are live
- Gated claim: two live private upstream LLM runtimes remain blocked until strict upstream proof passes

## First 90 Seconds

Say this before architecture:

> Before we talk about agents, databases, or infrastructure, I want you to create the data.
>
> Open the game on your phone. Move the boat, collect items, grab a powerup, and try not to cross another player's trail.
>
> In two minutes, this room will create a live event stream: coordinates, collisions, powerups, freezes, score changes, and replay moments.
>
> The trick is simple: the model is not guessing. SQL decides what happened. The model only gets to decide how to say it.

Then stop talking for a moment. Let the room play.

## The 18-Minute Spine

| Time | Move | What the room should believe |
|---:|---|---|
| 0:00-2:30 | Play | This is a real mobile/browser 3D app on OCI, not a slide-only demo |
| 2:30-4:00 | Reveal telemetry | Gameplay is an event stream with coordinates, collisions, powerups, trails, freezes, and score |
| 4:00-5:45 | Oracle AI Database | Agent memory is SQL facts, JSON payloads, graph relationships, vector-ready memory, traces, and governance |
| 5:45-7:30 | PAF context and commentary | The runtime builds bounded evidence before the model phrases anything |
| 7:30-9:30 | Architecture | OKE, Socket.IO, Coherence, Oracle AI Database, and PAF are deployed together |
| 9:30-12:00 | Harness | Agent = Model + Harness; the model emits tokens, the harness owns the system |
| 12:00-14:30 | Continual learning pattern | Token space, structured space, weight space, and skill space each have different rules |
| 14:30-16:30 | Notebook CTAs | The audience can take the pattern into harness, context, and long-conversation work |
| 16:30-18:00 | Close | Start with real events, ground them in governed data, let the model phrase, not fabricate |

## Proof Stack

Run this when you need the live receipt:

```bash
npm run check:conference-demo:stage -- --skip-refresh
```

Use this when you need fresh proof:

```bash
npm run check:conference-demo:transport
npm run check:conference-demo:game
npm run check:conference-demo -- --skip-proof
npm run check:model-ai-demo:proof
npm run check:conference-demo:stage -- --skip-refresh
```

What to read out:

- `Game smoke: ready`
- `Mobile: pass; mode RUNNING; joystick 134x134; boat y -0.068; seat depth 0.071`
- `PAF health: pass`
- `PAF wiring: Canvas yes; in-db agent yes; router shadow oci-base -> oci-fine-tuned`
- `Model proof: adapter ready_with_upstream_llm_blocker; strict upstream failed; strict blocker expected yes`

## Architecture Line

Use this, not a generic Oracle pitch:

> The frontend proves Oracle can run a modern interactive app. The database proves the AI has operational truth. The harness proves the model is not allowed to outrun the evidence.

Then unpack it:

- Browser 3D and mobile controls create the experience.
- OKE, Socket.IO, Coherence, and services keep the app live.
- Oracle AI Database stores event truth, JSON replay payloads, graph facts, vector-ready memory, traces, evals, and training examples.
- Private Agent Factory and Canvas give the agent workflow surface.
- The deployed harness decides what evidence is retrieved, which route is used, what policy applies, what trace is stored, and what line goes back into the game.

## Agent Harness Translation

Say this to AI engineers:

> The agent is not the model. The model emits tokens. The harness owns everything else.

| Demo behavior | Harness component |
|---|---|
| Commentary must not invent events | SQL evidence package and deterministic fallback |
| Commentary must use powerups and freezes | Structured event ledger plus JSON metadata |
| Similar prior moments should matter only when present | Scoped vector-ready memory |
| "Who froze whom?" needs causality | Graph facts |
| Canvas can shape the agent but not bypass truth | Canvas plus source metadata |
| Live output must be short and safe | Output policy, profanity guard, length limit |
| Claims must be auditable | Trace persistence and stage receipts |
| Failure should not kill the demo | Fallback route and smoke session |

The practical line:

> A bigger context window is not memory. A vector table is not memory. Production memory needs persistence, scope, retrieval, provenance, deletion, and independent tests.
>
> Facts live in structured space. Current reasoning lives in token space. Stable behavior can move into weight space. Repeated workflows graduate into skills only when the harness can test and govern them.

## What To Say About Canvas

Safe:

> Canvas is configured as the business-facing agent surface. The harness connects it to Oracle AI Database evidence and records whether Canvas produced a specific line.

Do not say:

> Canvas generated this exact sentence.

Unless response metadata proves it.

If challenged:

> The response metadata is the source of truth. If it says `canvas:null`, I say Canvas is configured, not that Canvas produced this line. That is the point of the harness.

## What To Say About Select AI And In-DB Agents

Safe:

> Select AI is the presenter-facing natural-language-over-data path. The runtime keeps facts deterministic first, then can use Select AI or an in-database package for bounded summarization when configured.

If challenged:

> I do not make the runtime depend on vague SQL generation. Explicit SQL builds the evidence package; natural language is layered on top where it helps the demo and developer workflow.

## What To Say About Model AI

Safe:

> Live today: adapter handoff, route metadata, tier-1000 canary, Oracle AI Database traces, training capture, and promotion evaluation.

Gated:

> I am not claiming two live private upstream LLM runtimes until strict upstream proof reports `runtime_mode=upstream-llm`.

Why this helps:

> AI engineers trust systems that can say no to their own marketing claim. That is why the red strict gate is useful.

## Failure Pivots

If the room Wi-Fi is rough:

> I have a smoke session because the pattern matters more than Wi-Fi bravery. The same event ledger, context API, commentary guardrails, and metadata are still provable.

Then run:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

If the AI line is boring:

> Good. Boring and grounded beats exciting and invented. The harness can improve style, but it should not let the model create facts.

If someone asks whether this is production:

> This is demo scale, but production-shaped: normalized events, replay manifests, SQL truth, JSON payloads, graph causality, vector memory, output policy, observability, and human override paths.

## Notebook CTAs

End with three routes, not a vague "learn more":

1. **Build the harness**: `enterprise_data_agent_heavyweight.ipynb`
   - Use it for memory, tool registry, scratchpad, deterministic compute, retrieval, identity, traces, and budget control.
2. **Engineer memory and context**: `memory_context_engineering_agents.ipynb`
   - Use it to decide what enters the model window now and what stays durable in Oracle AI Database.
3. **Master long conversations**: `oracle_agent_memory_long_conversations (1).ipynb`
   - Use it for recent context, rolling summaries, vector retrieval, structured memory, episodic memory, scoped retrieval, and leakage tests.

Final assignment:

> Pick one workflow that already emits events. Store those events in Oracle AI Database. Build a small harness that retrieves grounded context, calls deterministic tools, persists traces, and lets the model phrase the final response.

## Close

> The game is the wrapper. The pattern is the point.
>
> Start with real events. Store them where governance lives. Retrieve context deliberately. Let Canvas shape the agent experience. Keep the harness responsible for truth, tools, policy, memory, and the live-system connection.
>
> That is how modern AI apps become something people can play with, inspect, trust, and adapt.
