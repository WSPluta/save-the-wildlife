# Slide Outline

Use a teal-led Oracle technical style: ivory or charcoal canvas, sparse headlines, thin teal/sky connectors, Pine for governance, restrained Oracle Red only on the final CTA.

## Slide 1 - "Play First. Architecture Second."

**Claim:** The audience is about to generate the data the agent will use.

**Visual:** Use [stage-entry.html](stage-entry.html) or a full-screen QR/URL over a dark charcoal background. Use the verified mobile game screenshot if available.

**Speaker notes:**
Open with the URL. Ask people to join on mobile. Say the data they generate will become the agent context. Keep the opening under 45 seconds; the first emotional beat is play, not architecture.

**On-slide text:**
`http://130.162.174.167/`

**Proof cue:** Public mobile smoke is `ready`: `RUNNING`, joystick visible, safe opening spawn, boat seated at waterline.

## Slide 2 - "A Game That Emits Match Intelligence"

**Claim:** This is not generic gameplay; it is structured telemetry plus replay evidence.

**Visual:** Event chips in a horizontal timeline:
`game_started`, `position_sample`, `powerup_collected`, `trail_crossed`, `player_frozen`, `replay_clip`, `game_over`.

**Speaker notes:**
Mention powerups, trails, freezes, coordinates, scores, related player IDs, JSON metadata, and replay clips around key moments.

## Slide 3 - "The Model Does Not Watch Raw Footage"

**Claim:** Oracle AI Database connects gameplay truth to replay evidence.

**Visual:** Four lenses over one stream:
`SQL facts`, `JSON replay docs`, `Graph relationships`, `Vector memory`.

**Speaker notes:**
This is the gaming template. Telemetry explains what happened. Replay shows it. The agent receives evidence and clip pointers, not unlimited video. If the smoke session has no replay rows, say that explicitly and keep replay as the configured path, not returned evidence for this exact call.

## Slide 4 - "Runtime Path: Evidence First, Model Last"

**Claim:** The demo uses deterministic context before creative phrasing.

**Visual:** Flow:
Browser -> ingress -> `ws-server` -> Coherence fanout -> score/replay -> Oracle AI Database -> `private-agent-factory` -> Select AI/in-db agents/model route/Canvas when selected -> `commentary.ready`.

**Speaker notes:**
Emphasize that Redis is no longer in the runtime path. Coherence handles Socket.IO fanout; Oracle AI Database holds the evidence; generation remains bounded with live output under 200 characters, profanity guard, and no invented events or unrecorded replay moments. This is the line AI engineers should remember: explicit context first, model phrasing last.

## Slide 5 - "Live Proof: Commentary From The Timeline"

**Claim:** The commentator line is grounded in recorded events.

**Visual:** Terminal/API response callout with fields:
`source`, `fallback_source`, `model_route.runtime_mode`, `canvas`, `in_db_agent`, `summary`, `capabilities.graph_facts`.

**Speaker notes:**
Show `/paf/api/context` and `/paf/api/commentary`. Read the summary fields aloud: shield, trail crossing, freeze, coordinates, replay clip evidence when present. Read the metadata too: `source`, `fallback_source`, `canvas`, `in_db_agent`, and `model_route.runtime_mode`.

**Proof boundary:** If `canvas:null`, do not say Canvas produced the line. Say Canvas is configured and the harness metadata identifies the exact path.

## Slide 6 - "Canvas Shapes, Harness Proves"

**Claim:** Canvas is the agent-building surface; the deployed harness is the live-system connection.

**Visual:** OKE service map:
`web`, `ws-server`, `score`, `replay`, Coherence, Oracle AI Database, and `private-agent-factory`.

**Speaker notes:**
PAF has `/healthz` and `/api/commentary`; it uses Oracle wallet config, GenAI settings, Canvas auth, and in-db Select AI setup. The real-time layer uses Coherence rather than Redis. The point for AI engineers is that business users can shape the Canvas experience while the harness owns evidence, policy, fallback behavior, source metadata, and broadcast into the game.

## Slide 7 - "Agent = Model + Harness"

**Claim:** Most agent quality lives outside the model.

**Visual:** Formula in the center, orbiting labels:
memory, tools, retrieval, SQL, identity, budgets, trace, safety.

**Speaker notes:**
From the heavyweight notebook: the model emits tokens; the harness owns state, dispatch, memory, context, retries, policy, traces, and deterministic work. A vector database is not a memory system; production memory needs scope, provenance, deletion, retrieval, and governance.

## Slide 8 - "Harness Pattern In This Demo"

**Claim:** The game is a compact enterprise agent pattern.

**Visual:** Two-column mapping:

| Game demo | Enterprise equivalent |
|---|---|
| Game events | Business events |
| Replay clips | Media evidence |
| SQL summary | Governed context |
| Graph facts | Relationship/cause context |
| Vector memories | Similar prior moments |
| Select AI | Natural-language data access |
| PAF Canvas | Business-shaped agent workflow and phrasing |
| Endpoint harness | Governed connection to live systems |
| Profanity/length guard | Output policy |
| Prior sessions | Durable memory |

**Speaker notes:**
For gaming, this becomes live action commentary, instant replay captions, post-match recaps, player memory, highlight search, and broadcast-safe output. The same architecture also works for enterprise event streams: Canvas for the agent experience, harness for governed connectivity.

## Slide 9 - "Where The Notebooks Take You Next"

**Claim:** The game is the front door; the notebooks are the developer path.

**Visual:** Three notebook cards:
1. Enterprise Data Agent Harness
2. Memory and Context Engineering
3. Long Conversation Memory

**Speaker notes:**
CTA each notebook: build the harness, engineer memory/context, prove scoped retrieval and long conversation continuity. The game is the front door; the notebooks are the runnable developer path.

## Slide 10 - "CTA: Build Agents Around Truth"

**Claim:** Modern enterprise agents need governed memory, deterministic tools, and bounded generation.

**Visual:** Final flow with four verbs:
Capture -> Ground -> Govern -> Act.

**Speaker notes:**
Close with: start from real events, store them where governance lives, retrieve context deliberately, and keep the harness readable.

**On-slide CTA:**
Play the demo. Inspect the SQL. Run the notebooks. Adapt the harness.

**Final spoken line:**
SQL decides what happened. The model decides how to say it. The harness decides whether it is allowed to say it.
