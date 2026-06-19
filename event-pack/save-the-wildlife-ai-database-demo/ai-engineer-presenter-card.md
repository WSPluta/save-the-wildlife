# AI Engineer Presenter Card

Use this when you need the shortest path from live game energy to a serious AI engineering argument.

## The Limbic Opening

Say this before architecture:

> Before we talk about agents, databases, or infrastructure, I want you to create the data.
>
> Open the game on your phone. Move the boat, collect trash, grab a powerup, and try not to cross another player's trail.
>
> In two minutes, the room will create a live event stream: coordinates, collisions, powerups, freezes, score changes, and replay moments. Then we will ask an agent to comment on what happened.
>
> The trick is that the model is not guessing. SQL decides what happened. The model only gets to decide how to say it.

Keep the first line calm. Let the game do the energy work.

## Why AI Engineers Should Care

This is not a toy AI sentence generator. It is a compact version of a production pattern:

- A modern interactive app runs on OCI with browser 3D, Socket.IO, OKE, Coherence, Oracle AI Database, and Oracle Private Agent Factory.
- The app emits real operational events, not a fake prompt.
- Oracle AI Database holds the facts, replay evidence, graph relationships, vector-ready memory, traces, evals, and training examples.
- The harness builds bounded context, calls deterministic tools, enforces output policy, and broadcasts only grounded commentary.
- Canvas shapes the agent experience; the harness keeps it connected, governed, and live.

The line to land:

> Modern AI apps are not one giant prompt. They are live systems with memory, tools, traces, policy, and a model inside a harness.

## Current Receipts

Use this when someone asks, "what is actually live right now?"

- Deployed commit: `e7d4543`
- Generated stage receipt: `.codex_tmp/conference-stage-brief/latest.md`
- Game endpoint: `http://130.162.174.167/`
- Game smoke: use `.codex_tmp/conference-stage-brief/latest.md` as the authority
- Transport smoke: use `.codex_tmp/conference-stage-brief/latest.md` as the authority
- Mobile proof: joystick visible, `RUNNING`, safe nearest-trash buffer, boat seated at waterline when game smoke or manual visual proof is current
- PAF proof: Oracle, GenAI, Canvas, Select AI, in-db agent, graph/replay/vector retrieval, and model router configured
- Conference preflight: `ready_with_caveats`

Say:

> The stage brief is the authority. Transport can be green, visual proof can be separate, and the AI path can be green with boundaries. That is the point: the harness is allowed to say "this part is proven" and "this part is configured but not the source of this exact line."

## The Proof Ladder

Use this order. Do not jump straight to model routing. AI engineers will trust the ladder if every rung has a clear receipt and a clear boundary.

| Rung | What to show | What it proves | What it does not prove |
|---|---|---|---|
| 1. Play | Audience joins `http://130.162.174.167/` | A modern mobile/browser 3D app is live on OCI | AI quality |
| 2. Game smoke | `npm run check:conference-demo:game` | Public mobile/desktop playability, joystick, item counts, safe start, boat-waterline contact | Commentary correctness |
| 3. Facts | Event chips: `powerup_collected`, `trail_crossed`, `player_frozen`, `game_over` | The game emits structured operational truth | That the model generated anything |
| 4. Context | `/paf/api/context` | Oracle AI Database can assemble SQL, JSON, graph, replay, and vector evidence when present | Replay/vector evidence for a smoke call when counts are zero |
| 5. Commentary | `/paf/api/commentary` | The harness returns bounded, traceable language with source metadata | Canvas generation unless `canvas` or `source` proves it |
| 6. Harness | `Agent = Model + Harness` slide | The engineering work is retrieval, tools, policy, memory, fallback, trace, and live-system connection | That one prompt is enough |
| 7. Scale proof | `.codex_tmp/model-ai-readiness/proof-bundle.md` | Tier-1000 canary, score-row proof, adapter handoff, trace/eval/training path | Two live private upstream LLM runtimes |
| 8. CTA | notebooks | Developers can take the pattern into harness, memory, and long-conversation work | That the demo is the final production product |

Current proof receipt:

```bash
npm run check:model-ai-demo:proof
```

Current expected output:

```text
adapter_verdict=ready_with_upstream_llm_blocker
strict_verdict=failed
proof_bundle=.codex_tmp/model-ai-readiness/proof-bundle.md
```

How to say it:

> Tier 1000 proves the harness: 1000 joins, 1000 score rows, 1000 commentary responses, zero duplicate commentary, and p95 around 2.4 seconds.
>
> `upstream formats openai:2` proves the private handoff contract for evidence-bearing model calls.
>
> The strict upstream gate is intentionally still red because the endpoints are behavior adapters today. That is a good thing. The demo refuses to claim two live LLM runtimes before the runtime proves it.

The room should leave with this mental model:

> The frontend proves Oracle can run a modern interactive app. The database proves the AI has operational truth. The harness proves the model is not allowed to outrun the evidence.

## The Oracle Argument

Avoid "Oracle also has AI." That is too weak.

Say:

> The useful claim is not that Oracle can host a game. The useful claim is that a modern app can run on Oracle infrastructure and keep its AI layer close to governed operational truth.
>
> The game is browser 3D and mobile controls. The backend is OKE, Socket.IO, Coherence, and services. The intelligence layer is Oracle AI Database plus Private Agent Factory. That is a real app shape, not a slide-only reference architecture.

Then make the database point:

> For agents, memory is not just vectors. Memory needs SQL facts, JSON payloads, graph relationships, vector similarity, identity, deletion, provenance, and audit. That is why Oracle AI Database is interesting here.

## The Harness Argument

Use this when AI engineers ask where the real engineering is.

> The model emits tokens. The harness owns the work.
>
> In this demo the harness reads Oracle AI Database, builds the evidence package, routes through Select AI, in-database agents, model adapters, or Canvas when selected, applies length and profanity policy, records traces, and sends the final line back into the game.
>
> If one layer is slow, the harness falls back. If the evidence is missing, the harness should not let the model invent it. If the model route lacks runtime proof, the harness marks the claim blocked.

## The Honest Boundary

Say this without apology:

> Live today: game, OKE deployment, PAF route, Oracle AI Database evidence path, Select AI/in-db agent path, Canvas configuration, tier-1000 canary, training export, trainer dry-run, and OpenAI-compatible adapter handoff.
>
> Not claiming today: two live private upstream LLM runtimes. That claim waits until strict upstream readiness passes.

That boundary builds trust with engineers.

## The Three Claims To Land

Use these when you need to tighten the room back to the thesis.

1. **Modern app claim**

   > This is not a form over a table. It is a mobile-playable, browser-3D, real-time app on OCI, with OKE services, Socket.IO, Coherence fanout, and a live game loop.

2. **Oracle AI Database claim**

   > The AI layer is useful because the operational truth is close: SQL facts, JSON event and replay payloads, graph relationships, vector-ready memory, traces, and training examples sit in Oracle AI Database.

3. **Agent engineering claim**

   > The model is the least interesting part to over-mystify. The harness is where the app becomes trustworthy: context construction, deterministic tools, memory scoping, policy, fallback, source metadata, and broadcast back into the live experience.

## The 18-Minute Spine

| Time | Move | Proof |
|---:|---|---|
| 0:00 | Limbic opening | phone game URL |
| 0:45 | Audience plays | movement, powerups, trails |
| 2:30 | Reveal telemetry | event timeline |
| 4:00 | Oracle AI Database | SQL, JSON, graph, vector, memory |
| 5:45 | Live commentary | `/paf/api/context`, `/paf/api/commentary` |
| 7:30 | Architecture | OKE, Coherence, PAF, Oracle AI Database |
| 9:30 | Harness | Agent = Model + Harness |
| 12:00 | Model AI proof | `.codex_tmp/model-ai-readiness/proof-bundle.md` |
| 14:30 | Notebook CTAs | harness, memory, long conversation |
| 16:30 | Close | Capture -> Ground -> Govern -> Act |

## Close

> The game is the wrapper. The pattern is the point.
>
> Start with real events. Store them where governance lives. Retrieve context deliberately. Let Canvas shape the agent experience. Keep the harness responsible for truth, tools, policy, memory, and the live-system connection.
>
> That is how you build AI apps people can play with, inspect, trust, and adapt.
