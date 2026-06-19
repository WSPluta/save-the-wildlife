# AI Engineer Q&A

Use this after the live play moment, when the room starts asking the useful questions. Keep answers short, then point to proof. The goal is not to win a debate. The goal is to show that the demo has engineering boundaries.

## How To Answer

Use this shape:

1. Answer the question directly.
2. Name the proof receipt or source file.
3. Name the boundary if there is one.
4. Move back to the thesis: **live systems need memory, tools, traces, policy, and a model inside a harness.**

## Fast Answers

| Question | Short answer | Proof handle | Boundary |
|---|---|---|---|
| Is this actually live? | Yes. The public game smoke reaches `RUNNING` on mobile and desktop, and PAF health passes. | `.codex_tmp/conference-game-smoke/latest.md`, `.codex_tmp/conference-preflight/latest.md` | Smoke proves the current public path, not every future network condition. |
| Is this just a game? | The game is the signal generator. The reusable asset is the event-to-intelligence pattern. | `server/lib/gameEvents.js`, `deploy/db/stwl_game_events.sql`, [source-map.md](source-map.md) | Do not position the toy scale as final production scale. |
| Where does the data come from? | Gameplay events: coordinates, collisions, powerups, trail crossings, freezes, scores, and replay metadata. | `/paf/api/context`, `STWL_GAME_EVENTS`, `STWL_EVENT_DOCUMENTS`, `STWL_GRAPH_EDGES` | Do not say the model watched raw video. |
| Why Oracle AI Database? | Agent memory is a data problem: SQL facts, JSON payloads, graph relationships, vector memory, identity, traces, deletion, and audit. | [source-map.md](source-map.md), `deploy/db/stwl_match_intelligence.sql` | Vector is one component, not the whole memory system. |
| Why not just send logs to an LLM? | Because facts, constraints, and scoring need deterministic grounding. SQL decides what happened; the model phrases it. | `deploy/db/stwl_commentary_pkg.sql`, `/paf/api/commentary` | The model should not infer unrecorded events. |
| Where is the harness? | In the deployed `private-agent-factory` service and surrounding runtime flow: context build, route selection, policy, fallback, trace, broadcast. | `private-agent-factory/index.js`, [architecture.md](architecture.md) | Canvas is not the whole harness. |
| Where does Canvas fit? | Canvas is the business-facing agent surface. The harness connects Canvas to governed evidence and records whether Canvas produced a line. | `/paf/healthz`, response metadata, `callPafCanvas` | If `canvas:null`, do not claim Canvas generated that sentence. |
| Where does Select AI fit? | Presenter-facing natural language over gameplay telemetry, and controlled summarization where useful. Runtime summaries stay explicit first. | `deploy/db/select_ai_profile_template.sql`, `STWL_GAMEPLAY_AI` | Do not claim vague LLM SQL generation is the core runtime path. |
| Are there in-database agents? | The path is configured and attempted through the commentary package. | `DBMS_CLOUD_AI_AGENT.RUN_TEAM` in `deploy/db/stwl_commentary_pkg.sql`, `/paf/healthz` | For a specific response, trust `in_db_agent` metadata. |
| Are two private LLMs live? | Not as a live upstream claim yet. Adapter handoff is live; strict upstream is still gated. | `.codex_tmp/model-ai-readiness/proof-bundle.md` | Do not claim two live private LLM runtimes until strict upstream passes. |
| What did tier 1000 prove? | The harness path, score-row proof, adapter-mode commentary, trace/eval metadata, and no duplicate commentary under load. | `.codex_tmp/model-ai-readiness/proof-bundle.md` | It does not prove upstream LLM runtime. |
| What would production add? | SDK ingestion, clip manifests in object storage, moderation, identity policy, observability, caching, human override, and promotion gates. | [architecture.md](architecture.md), [conference-readiness-scorecard.md](conference-readiness-scorecard.md) | Demo scale uses telemetry plus replay JSON, not full video ingestion. |
| How do you prevent hallucinated commentary? | Evidence package first, deterministic SQL summary, output limits, profanity guard, source metadata, trace persistence, and fallback. | `/paf/api/commentary`, `enforceCommentary`, `clamp_text` | The receipt must show the line matches recorded evidence. |
| What about latency? | Live commentary is kept short, context is bounded, and runtime can fall back to deterministic SQL if a model route is slow. | `.codex_tmp/model-ai-readiness/proof-bundle.md`, PAF fallback path | Do not make broad latency guarantees beyond the receipts. |
| What about security? | Put identity and policy in the data and harness layers, not in prompt instructions. | Agent-harness pattern, Oracle AI Database policy direction, source map | Current demo proves the pattern, not a full enterprise security certification. |
| Why Coherence? | It keeps the realtime backend Oracle-aligned after Redis removal and handles Socket.IO fanout for multi-pod `ws-server`. | [architecture.md](architecture.md), Coherence fanout notes | Do not frame it as a generic cache swap. It is runtime coordination. |
| Why should AI engineers care? | Because this is how AI apps become inspectable: events, memory, tools, policy, traces, model routing, and a live UX. | [claim-ledger.md](claim-ledger.md), [conference-readiness-scorecard.md](conference-readiness-scorecard.md) | The game is the wrapper; the pattern is the point. |

## Deeper Answers

### "What exactly is the agent?"

> The agent is not just the model. In this demo, the model emits tokens. The harness builds the context from Oracle AI Database, calls deterministic SQL and evidence tools, routes through Select AI, in-database agents, Canvas, model adapters, or SQL fallback, applies output policy, records metadata, and broadcasts the final line back into the game.

Proof:

- [architecture.md](architecture.md)
- `private-agent-factory/index.js`
- `deploy/db/stwl_commentary_pkg.sql`
- `.codex_tmp/conference-preflight/latest.md`

Boundary:

> For a specific line, the response metadata decides which path produced it.

### "What is agent memory in this demo?"

> Memory is not a bag of vectors. The demo treats memory as operational data: session facts, player history, event documents, graph relationships, replay manifests, vector-ready similar moments, traces, eval outputs, and training examples.

Proof:

- `STWL_GAME_EVENTS`
- `STWL_EVENT_DOCUMENTS`
- `STWL_GRAPH_VERTICES`
- `STWL_GRAPH_EDGES`
- `STWL_REPLAY_CLIPS`
- `STWL_AGENT_MEMORIES`
- `.codex_tmp/model-ai-readiness/proof-bundle.md`

Boundary:

> If the smoke receipt says `Vector memories: 0`, say vector memory is an enabled path, not returned evidence for that call.

### "What makes this a production gaming template?"

> The production version would not ask a model to watch a whole match. The game or engine emits normalized events. Replay/video is indexed by event id, timecode, player id, and semantic tags. Oracle AI Database holds the match intelligence. The agent gets bounded evidence plus clip pointers and produces live lines, replay captions, recaps, or titles.

Proof:

- `deploy/db/stwl_match_intelligence.sql`
- replay service source in [source-map.md](source-map.md)
- [architecture.md](architecture.md)

Boundary:

> The conference demo proves the pattern with telemetry and replay JSON. It does not claim full video ingestion.

### "Why not fine-tune the facts?"

> Changing facts belong in memory. Fine-tuning should learn stable behavior: concise phrasing, evidence discipline, source citation shape, safety, and token efficiency. Scores, coordinates, powerups, and player history stay in Oracle AI Database because they change every match.

Proof:

- `.codex_tmp/stwl-behavior-v1-live.jsonl`
- `.codex_tmp/model-ai-readiness/proof-bundle.md`
- admin proof strings: `25 live examples`, `Trainer dry-run`

Boundary:

> Behavior training path is ready by dry-run and adapter handoff. Live fine-tuned upstream serving remains gated.

### "Why should this resonate beyond Oracle?"

> Because the architecture is not Oracle magic. It is a pattern AI engineers already understand: event stream, source of truth, retrieval, memory, deterministic tools, model adapter, trace, policy, and UI feedback. Oracle AI Database matters because it lets more of that pattern live near governed operational data instead of being scattered across separate stores too early.

Proof:

- [source-map.md](source-map.md)
- [notebook-cta-map.md](notebook-cta-map.md)
- `.codex_tmp/conference-preflight/latest.md`

Boundary:

> Keep the claim practical: fewer moving parts around governed data, not "one product magically solves AI."

## Answers To Avoid

- "The model watched the match."
- "Canvas generated this exact line" when response metadata says `canvas:null`.
- "The fine-tuned model is live" before strict upstream passes.
- "Vector memory returned similar moments" when the smoke receipt says `Vector memories: 0`.
- "This is production-ready as-is."
- "Select AI generates arbitrary runtime SQL."
- "The database is only a vector store."

## Reset Lines

Use these when an answer starts getting too long:

- "The clean version is: SQL first, LLM last."
- "The model is not the system. The harness is the system."
- "If the event is not in the database, the commentator should not say it."
- "Facts stay in Oracle AI Database. Stable behavior can move into weights."
- "The proof is in the metadata, not in the story I would like to tell."
