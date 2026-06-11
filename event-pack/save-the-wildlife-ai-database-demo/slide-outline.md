# Slide Outline

Use a teal-led Oracle technical style: ivory or charcoal canvas, sparse headlines, thin teal/sky connectors, Pine for governance, restrained Oracle Red only on the final CTA.

## Slide 1 - "Play First. Architecture Second."

**Claim:** The audience is about to generate the data the agent will use.

**Visual:** Full-screen game screenshot or QR/URL over a dark charcoal background.

**Speaker notes:**
Open with the URL. Ask people to join on mobile. Say the data they generate will become the agent context.

**On-slide text:**
`http://130.162.174.167/`

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
This is the gaming template. Telemetry explains what happened. Replay shows it. The agent receives evidence and clip pointers, not unlimited video.

## Slide 4 - "Runtime Path: Evidence First, Model Last"

**Claim:** The demo uses deterministic context before creative phrasing.

**Visual:** Flow:
Game -> Socket.IO -> `STWL_GAME_EVENTS` + replay clips -> `/paf/api/context` -> Select AI/in-db agents -> PAF Canvas -> UI/API.

**Speaker notes:**
Emphasize bounded generation: live output under 200 characters, profanity guard, no invented events or unrecorded replay moments.

## Slide 5 - "Live Proof: Commentary From The Timeline"

**Claim:** The commentator line is grounded in recorded events.

**Visual:** Terminal/API response callout with fields:
`source: paf-canvas`, `fallback_source: select-ai`, `evidence.replay_clip_count`, `capabilities.graph_facts`.

**Speaker notes:**
Show `/paf/api/context` and `/paf/api/commentary`. Read the summary fields aloud: shield, trail crossing, freeze, coordinates, replay clip evidence when present.

## Slide 6 - "Canvas Agent, Production Harness"

**Claim:** Canvas is the agent-building surface; the deployed harness is the live-system connection.

**Visual:** OKE service map:
`web`, `ws-server`, `score`, `replay`, Coherence, Oracle AI Database, and `private-agent-factory`.

**Speaker notes:**
PAF has `/healthz` and `/api/commentary`; it uses Oracle wallet config, GenAI settings, Canvas auth, and in-db Select AI setup. The point for AI engineers is that business users can shape the Canvas agent while the harness owns evidence, policy, fallback behavior, and broadcast into the game.

## Slide 7 - "Agent = Model + Harness"

**Claim:** Most agent quality lives outside the model.

**Visual:** Formula in the center, orbiting labels:
memory, tools, retrieval, SQL, identity, budgets, trace, safety.

**Speaker notes:**
From the heavyweight notebook: the model emits tokens; the harness owns state, dispatch, memory, context, retries, and deterministic work.

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
CTA each notebook: build the harness, engineer memory/context, prove scoped retrieval and long conversation continuity.

## Slide 10 - "CTA: Build Agents Around Truth"

**Claim:** Modern enterprise agents need governed memory, deterministic tools, and bounded generation.

**Visual:** Final flow with four verbs:
Capture -> Ground -> Govern -> Act.

**Speaker notes:**
Close with: start from real events, store them where governance lives, retrieve context deliberately, and keep the harness readable.

**On-slide CTA:**
Play the demo. Inspect the SQL. Run the notebooks. Adapt the harness.
