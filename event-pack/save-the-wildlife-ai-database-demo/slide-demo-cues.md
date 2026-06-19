# Slide Demo Cues

Use this as the on-stage cheat sheet.

## Slide 1 - Play First

**Action:** Show [stage-entry.html](stage-entry.html) or the game URL / QR.

**Say:**
Open this on your phone. You are about to generate the telemetry that the agent will use.

**Proof anchor:** Use `.codex_tmp/conference-stage-brief/latest.md`. Public mobile smoke must be `ready`, or [manual-visual-proof.md](manual-visual-proof.md) must be completed from a normal browser before making the visual/mobile claim.

**Do not explain yet:** PAF, Select AI, harness. Let the room play first.

## Slide 2 - Events

**Action:** Point at the event timeline.

**Say:**
The visible mechanics are powerups, trails, freezes, movement, and replay moments. The agent sees those as structured evidence.

**Proof phrase:**
The row has a timestamp, player, event type, score, coordinates, related player/item IDs, and JSON metadata.

## Slide 3 - Database

**Action:** Show schema or simplified table.

**Say:**
This is the trust boundary. If the event or replay clip is not recorded here, the commentator should not invent it.

## Slide 4 - Runtime Path

**Action:** Show architecture flow.

**Say:**
Evidence first. Model last. The runtime starts with explicit SQL/JSON/graph/vector context, can use Select AI or an in-database agent for a bounded draft, and routes that package through the deployed PAF harness. Canvas is configured as the business-facing agent surface, but the response metadata tells us which exact path produced a line.

**Proof boundary:** If the response says `canvas:null`, say Canvas is configured, not that Canvas generated that exact line.

## Slide 5 - Live Commentary

**Action:** Run:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

**Say:**
Look at the fields, not just the sentence. `source`, `fallback_source`, `model_route`, `canvas`, and `in_db_agent` show which runtime path actually produced the line. `summary` and `evidence` show the recorded events, graph facts, replay clips, and memory the line was allowed to use.

**Expected current caveat:** the smoke response can be valid with `canvas:null`, `in_db_agent:null`, and `runtime_mode=behavior-adapter`. That is a trust signal, not a failure.

## Slide 6 - Canvas Shapes, Harness Proves

**Action:** Show health:

```bash
curl -sS http://130.162.174.167/paf/healthz
```

For browser-free deployed proof, also show:

```bash
npm run check:conference-demo:transport
```

**Say:**
This is the connection we care about. The Canvas agent can be shaped by business users, but the harness is deployed with the game and wired to Oracle AI Database, OCI Generative AI, Select AI, Canvas, and the live commentary broadcast.

**Say if challenged:**
The business surface matters, but the harness is the engineering product. It decides what evidence gets retrieved, what fallback runs, what metadata is recorded, and what can be broadcast.

## Slide 7 - Harness

**Action:** Pause. Let this slide breathe.

**Say:**
The model emits tokens. The harness is everything else: context, tools, memory, identity, budgets, trace, safety, and the connection back to the live 3D environment.

**Memory line:**
A vector database is not a memory system. Memory becomes architecture when you need persistence, scoping, provenance, deletion, retrieval, and governance.

**Continual learning line:**
Keep the surfaces separate: current context in token space, governed evidence in structured space, stable behavior in weight space, and repeated workflows in tested skill space.

## Slide 8 - Enterprise Mapping

**Action:** Point from left to right.

**Say:**
For games, replace the demo replay JSON with production clip manifests and object-storage media. For enterprise, replace game events with business events. The architecture remains the same: Canvas for the agent experience, harness for governed connection to systems.

## Slide 9 - Notebook CTAs

**Action:** Name the three notebooks.

**Say:**
The game is the front door. The notebooks are the developer path: full harness, memory/context engineering, long-conversation memory, and the discipline to promote facts, behavior, and skills through different gates.

## Slide 10 - Close

**Action:** End on the four verbs.

**Say:**
Capture real events. Ground them in Oracle AI Database. Govern retrieval and identity. Let the model act inside a harness.

**Final line:**
SQL decides what happened. The model decides how to say it. The harness decides whether it is allowed to say it.

## Timing Rescue

If you are behind:

- Skip detailed PAF deployment explanation.
- Keep the commentary proof.
- Keep Agent = Model + Harness.
- Use the notebooks as a one-slide CTA instead of explaining each.

If you are ahead:

- Show the Select AI example prompts.
- Talk through scoped retrieval from the long-conversation notebook.
- Discuss Oracle AI Database as the enterprise trust boundary.
