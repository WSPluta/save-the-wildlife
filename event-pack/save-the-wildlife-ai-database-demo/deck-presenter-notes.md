# Deck Presenter Notes

Use this beside
[save-the-wildlife-ai-engineer-demo-deck.pptx](../../outputs/save-the-wildlife-ai-engineer-demo-deck.pptx).
The slides are intentionally sparse. These notes carry the proof, timing, and
claim boundaries.

## Slide 1: Play First. Architecture Second.

**Time:** 0:00-2:30

**Do:** Put the QR and game URL on screen. Ask people to join on mobile. Let the
room play before explaining the system.

**Say:**

> Before we talk about agents, databases, or infrastructure, I want you to
> create the data. Move the boat, collect items, grab a powerup, and try not to
> cross another player's trail. In two minutes, this room will create the event
> stream the agent uses.

**Proof cue:** stage brief must show game smoke `ready`; mobile should be
`RUNNING` with joystick visible.

**Boundary:** Do not start with architecture. The first beat is emotional:
people should feel the live app.

## Slide 2: A Game That Emits Agent-Ready Events

**Time:** 2:30-4:00

**Do:** Point at the event timeline and the `STWL_GAME_EVENTS` shape.

**Say:**

> Strip away the water and boats and you have the useful product: an event
> ledger. Session, room, player, timestamp, score, coordinates, related item,
> related player, and JSON metadata. That is where this AI story starts.

**Proof cue:** `powerup_collected`, `trail_crossed`, `player_frozen`, and
`game_over` appear in the seeded context receipt.

**Boundary:** Do not reduce the demo to "score commentary." The point is
mechanics-aware telemetry.

## Slide 3: The Model Does Not Watch Raw Footage

**Time:** 4:00-5:15

**Do:** Explain the four evidence lenses: SQL, JSON, graph, vector.

**Say:**

> The model does not watch raw footage. The game creates structured evidence.
> SQL decides facts. JSON carries flexible event and replay payloads. Graph
> explains causality. Vector memory helps when similar moments actually exist.

**Proof cue:** stage brief lists SQL source, JSON events, graph facts, and
whether replay/vector evidence exists for the smoke call.

**Boundary:** If replay clips or vector memories are zero in the receipt, say
they are enabled paths, not evidence returned for this exact call.

## Slide 4: Evidence First. Model Last.

**Time:** 5:15-6:45

**Do:** Walk left to right through browser, `ws-server`, Coherence, score/replay,
Oracle AI Database, PAF harness, and `commentary.ready`.

**Say:**

> Explicit context comes before phrasing. Socket.IO keeps the room live.
> Coherence handles fanout. Oracle AI Database holds the event truth. The PAF
> harness builds the evidence package, applies guardrails, and only then asks a
> model or fallback path to phrase the result.

**Proof cue:** transport smoke `ready`; game smoke `ready`; PAF health `pass`.

**Boundary:** Keep the Redis point crisp: it is removed from the runtime path;
Coherence is the realtime coordination layer.

## Slide 5: Commentary From The Timeline

**Time:** 6:45-8:15

**Do:** Show `/paf/api/context` or `/paf/api/commentary`. Read metadata, not
just the sentence.

**Say:**

> The line is less important than the receipt. `source`, `fallback_source`,
> `runtime_mode`, `canvas`, `in_db_agent`, and trace metadata tell me which path
> actually produced this response. That is how the harness keeps the stage story
> honest.

**Proof cue:** current smoke line is under 200 characters, source is present,
fallback is present, trace is persisted.

**Boundary:** If `canvas:null`, do not say Canvas produced the line. If
`in_db_agent:null`, do not say the in-db agent produced it.

**Speed proof:** When the public receipt shows `source=select-ai`, call out the
latency difference carefully: the Select AI fast path returned in about 1.1
seconds after the latest deployment, with the earlier smoke at about 1.57
seconds. The older external model orchestration path was roughly 36 seconds.
Say "same recorded telemetry, fewer hops, lower latency," not "no model."

## Slide 6: Canvas Shapes. Harness Proves.

**Time:** 8:15-9:45

**Do:** Reframe PAF Canvas as the business-facing surface, not the whole agent
system.

**Say:**

> Canvas is where the agent experience can be shaped. The engineering work is
> the harness: evidence retrieval, SQL, tool routing, identity, policy,
> fallback, trace, and broadcast back into the live system.

**Proof cue:** PAF health reports Canvas config, Select AI profile, in-db agent
path, graph/replay/vector retrieval, and router config.

**Boundary:** Canvas is configured and part of the architecture. A specific
output is only a Canvas output when response metadata proves it.

## Slide 7: Agent = Model + Harness

**Time:** 9:45-11:45

**Do:** Slow down. This is the AI engineer lesson.

**Say:**

> The agent is not the model. The model emits tokens. The harness owns memory,
> tools, retrieval, SQL, identity, budgets, traces, safety, fallback, and the
> live-system connection.

**Proof cue:** receipts show bounded commentary, source metadata, fallback
path, trace persistence, and strict upstream gate.

**Boundary:** Do not sell "more context" as memory. Say the production memory
line clearly: persistence, scope, provenance, deletion, retrieval, governance.

**Continual learning bridge:** Token space is the current prompt, evidence, and
output. Structured space is the Oracle AI Database layer the harness can query
and govern. Weight space is stable behavior learned before the turn. Skill
space is where repeated workflows become tested tools or playbooks.

## Slide 8: The Game Pattern Becomes An Enterprise Pattern

**Time:** 11:45-13:45

**Do:** Map the demo objects to enterprise objects.

**Say:**

> Replace game events with business events. Replace replay clips with media
> evidence, tickets, transactions, or operational snapshots. Keep the shape:
> capture real events, ground them in governed data, retrieve deliberately, and
> let the model phrase inside policy.

**Proof cue:** event pack claim ledger and current proof snapshot connect each
claim to a receipt.

**Boundary:** Do not call it production complete. Call it demo scale but
production-shaped.

## Slide 9: The Notebooks Are The CTA

**Time:** 13:45-16:00

**Do:** Give three concrete learning routes.

**Say:**

> The game is the front door. The notebooks are the developer path. One teaches
> the harness. One teaches memory and context engineering. One teaches scoped
> long-conversation memory. The production learning model is to keep facts in
> structured space, keep current reasoning in token space, move only stable
> behavior into weights, and graduate repeated workflows into governed skills.

**Proof cue:** notebook filenames are listed in the master card and event pack:
`enterprise_data_agent_heavyweight.ipynb`,
`memory_context_engineering_agents.ipynb`, and
`oracle_agent_memory_long_conversations (1).ipynb`.

**Boundary:** Do not open notebooks live unless asked. They are the CTA, not the
main stage path.

## Slide 10: Build Agents Around Truth

**Time:** 16:00-18:00

**Do:** Close with the pattern, not the product list.

**Say:**

> Start with real events. Store them where governance lives. Retrieve context
> deliberately. Let Canvas shape the agent experience. Keep the harness
> responsible for truth, tools, policy, memory, and the live-system connection.

**Final line:**

> SQL decides what happened. The model decides how to say it. The harness
> decides whether it is allowed to say it.

**Boundary:** Do not add a new claim in the final minute. Close on the receipts
already shown.

## Timing Rescue

If the room play runs long, preserve slides 1, 2, 5, 7, and 10. Compress slides
3, 4, 6, 8, and 9 into one sentence each.

If the live API is slow, use the smoke command from
[stage-launch-card.md](stage-launch-card.md) and say:

> The pattern matters more than Wi-Fi bravery. The same event ledger, context
> API, commentary guardrails, and source metadata are still provable.
