# Demo Recording Script

Target length: 7 to 8 minutes.

Use this as the rehearsal voiceover. It is intentionally direct, practical, and proof-led.

## 0:00 - Play First. Architecture Second.

Before I show architecture, I want to start with the thing developers actually remember: a working demo.

This is Save the Wildlife. People join on mobile, steer a boat, collect trash, pick up powerups, and try not to cross another player's trail. If they cross that trail, they can be frozen.

That is the important bit. This is not a score-only demo. The mechanics create facts: powerups, trail crossings, freeze events, coordinates, player relationships, and replay moments.

The game is the wrapper. The event stream is the product.

## 0:35 - The Gameplay Truth

Let's cut through it: an AI commentator is only useful if it knows what actually happened.

In the game code, a trail collision does not become a vague log line. It becomes two explicit events: `trail_crossed` and `player_frozen`. The event includes the related player and the trail segment coordinates.

That is the difference between "an LLM says something sporty" and "a commentator explains a real moment from the match."

If the event is not in the database, the commentator should not invent it.

## 1:15 - Mobile Is A Real Requirement

For this talk, mobile is not a nice-to-have. The audience has phones, not gaming laptops.

The UI now has a touch joystick. The controls feed the same movement path as keyboard input, so desktop still works, but a player in the room can join from a phone and create the data live.

This matters for the story. We are not asking people to imagine telemetry. We let them create it.

The boring infrastructure work here is what makes the demo credible.

## 1:55 - Oracle AI Database As Match Intelligence

Once the events land, Oracle AI Database becomes the match intelligence layer.

SQL gives the authoritative summary: score, trash collected, marine hits, trail crosses, freezes, last coordinates, and prior best score. JSON keeps flexible metadata and replay documents. Graph explains who froze whom, who crossed whose trail, and how a moment relates to a player or item. Vector memory gives a path to compare similar prior moments.

This is the technical argument: the model is not the source of truth. The database is.

SQL decides what happened. The model decides how to say it.

## 2:45 - PAF Runtime: Evidence First, Model Last.

The PAF adapter exposes two useful proof points: `/api/context` and `/api/commentary`.

The context endpoint builds the evidence package. The commentary endpoint turns that evidence into a line, caption, title, or recap.

This is where Canvas matters. In a real enterprise workflow, the people closest to the business language can build or tune the agent in Oracle Private Agent Factory Canvas. The AI engineering job is the harness around it: connect Canvas to the live system, SQL evidence, Select AI or in-database drafts, policy, tracing, and fallback behavior.

Runtime generation is deliberately bounded. Live lines stay under 200 characters, profanity is blocked, replay captions only mention replay clips when a manifest exists, and history is only used when prior sessions exist.

That is the pattern AI developers should take away: do not make one giant prompt carry the system. Build a small harness around governed data.

## 3:35 - In-Database Agents And Select AI.

Select AI is useful here, but it is not a blank cheque for vague runtime SQL generation.

For the runtime path we prefer explicit SQL summaries. Then we use `DBMS_CLOUD_AI.GENERATE` or `DBMS_CLOUD_AI_AGENT.RUN_TEAM` for controlled phrasing from that summary.

For the presenter path, Select AI is brilliant because you can ask natural-language questions over the gameplay tables: who was frozen most, which powerup changed the match, which replay clip mattered.

That gives the room two levels of proof: deterministic runtime and natural-language exploration over the same governed data.

## 4:25 - Graph, Replay, And Memory.

The production-shaped part is important.

At demo scale, replay is a JSON clip and a manifest row. At production scale, that becomes an object-storage clip with a thumbnail, timecode, moderation status, and semantic tags.

The model still does not need to watch raw footage. It gets structured event evidence plus a clip pointer.

Graph is what lets us say why the moment mattered: this player crossed that player's trail, which caused a freeze, which changed the session. Vector memory is what lets us compare it with prior moments or a player's style.

Telemetry explains what happened. Replay shows it. Oracle AI Database connects both.

## 5:20 - PAF Is Deployed With The App.

This is not a manual side story. PAF is deployed as an OKE service with the rest of the app.

It has health checks, wallet mounting, config map wiring, canvas auth as a secret, and the same deployment rhythm as `web`, `ws-server`, `score`, `replay`, Coherence, Oracle AI Database, and the agent service.

That matters because AI demos fail when the clever part lives outside the deployable system.

If we cannot deploy it, test it, explain how it fails, and keep the Canvas connection alive inside the harness, it is not finished.

## 6:05 - The Harness Is The Product.

The learning point is the same one from the agent notebooks: agent quality is mostly outside the model.

The model emits tokens. Canvas can shape the agent experience. The harness owns tool calls, memory, retrieval, identity, budget, traceability, fallback behaviour, output policy, and broadcast back into the live 3D environment.

This repo now has tests around the claims we make: mobile controls, replay evidence, powerup and freeze capture, PAF context, replay gating, and no invented replay captions.

That is what makes the demo useful for AI developers. They can take the pattern and build from it.

## 6:55 - Close.

The game is the memorable wrapper. The pattern is the point.

Start with real events. Pair them with replay evidence. Store both where governance already lives. Let business users shape the agent in Canvas. Keep the harness responsible for truth, tools, policy, and the live-system connection.

That is a practical path from a conference game to production live commentary, instant replay context, post-match recap, and player memory.

Play the demo. Inspect the SQL. Run the notebooks. Adapt the harness.
