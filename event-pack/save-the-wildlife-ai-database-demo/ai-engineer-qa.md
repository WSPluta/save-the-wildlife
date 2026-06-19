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
| Why add bots? | Bots keep the room warm and generate mechanics-rich data when humans are sparse: powerups, trail drama, freezes, coordinates, and game-over traces. | [bot-data-and-ollama-training-runbook.md](bot-data-and-ollama-training-runbook.md), `bots/index.js` | Say they are data producers, not simulated human audience proof. |
| How does Ollama fit? | The private model adapter can call a secure A10-hosted Ollama `/api/chat` endpoint and report `runtime_mode=upstream-llm` when it is real. | `model-ai/inference/server.py`, [bot-data-and-ollama-training-runbook.md](bot-data-and-ollama-training-runbook.md) | Do not claim retraining improved the model until strict load proof passes. |
| What is production continual learning here? | Separate token space, structured space, weight space, and skill space. Facts stay structured; current context stays bounded; stable behavior can move into weights; repeated workflows become governed skills. | [continual-learning-operating-model.md](continual-learning-operating-model.md), `deploy/db/stwl_model_learning.sql` | Do not claim autonomous production weight updates or self-installed skills. |
| What would production add? | SDK ingestion, clip manifests in object storage, moderation, identity policy, observability, caching, human override, and promotion gates. | [architecture.md](architecture.md), [conference-readiness-scorecard.md](conference-readiness-scorecard.md) | Demo scale uses telemetry plus replay JSON, not full video ingestion. |
| How do you prevent hallucinated commentary? | Evidence package first, deterministic SQL summary, output limits, profanity guard, source metadata, trace persistence, and fallback. | `/paf/api/commentary`, `enforceCommentary`, `clamp_text` | The receipt must show the line matches recorded evidence. |
| What about latency? | Live commentary is kept short, context is bounded, and runtime can fall back to deterministic SQL if a model route is slow. | `.codex_tmp/model-ai-readiness/proof-bundle.md`, PAF fallback path | Do not make broad latency guarantees beyond the receipts. |
| What about security? | Put identity and policy in the data and harness layers, not in prompt instructions. | Agent-harness pattern, Oracle AI Database policy direction, source map | Current demo proves the pattern, not a full enterprise security certification. |
| Why Coherence? | It keeps the realtime backend Oracle-aligned after Redis removal and handles Socket.IO fanout for multi-pod `ws-server`. | [architecture.md](architecture.md), Coherence fanout notes | Do not frame it as a generic cache swap. It is runtime coordination. |
| Why should AI engineers care? | Because this is how AI apps become inspectable: events, memory, tools, policy, traces, model routing, and a live UX. | [claim-ledger.md](claim-ledger.md), [conference-readiness-scorecard.md](conference-readiness-scorecard.md) | The game is the wrapper; the pattern is the point. |

## Hard-Room Drill

Use these when a senior AI engineer compresses the question into one sharp
sentence. Answer directly, name the proof, then move back to the pattern.

### "What is the Oracle-specific insight here?"

> The Oracle-specific insight is not "put a game on cloud." The useful bit is
> keeping match truth, JSON event payloads, graph relationships, vector-ready
> memory, traces, evals, and deterministic fallback close to governed
> operational data. That reduces the number of places where an agent can lose
> provenance.

Proof handle:

- `.codex_tmp/conference-preflight/latest.md`
- [current-proof-snapshot.md](current-proof-snapshot.md)
- [source-map.md](source-map.md)

Boundary:

> I am not claiming one product magically replaces all AI engineering. I am
> claiming the database can carry more of the agent memory and evidence layer
> than people often assume.

### "Why not just build the whole thing in code?"

> You can. The point is deciding what belongs where. The harness stays in code
> because it owns live-system integration, evidence retrieval, fallback, trace,
> and policy. Canvas is useful when the business-facing agent experience needs
> to be shaped without bypassing that harness.

Proof handle:

- `/paf/healthz`
- [stage-launch-card.md](stage-launch-card.md)
- [architecture.md](architecture.md)

Boundary:

> Canvas is not the proof by itself. The metadata is the proof of which path
> produced a specific line.

### "What happens if the model route is slow or unavailable?"

> The harness degrades. It can use in-database paths, Select AI, model-router
> adapters, or deterministic SQL fallback. The live game should not depend on a
> single model call behaving perfectly.

Proof handle:

- `.codex_tmp/conference-preflight/latest.md`
- `fallback_source: oracle-sql`
- `trace_persisted: yes`

Boundary:

> This receipt proves fallback behavior and source metadata. It does not prove
> every production latency SLO.

### "Is this really agent memory, or just a database schema?"

> A schema is not memory by itself. It becomes memory when the harness uses it
> with scope, retrieval rules, provenance, deletion, and tests. This demo shows
> the pieces: session facts, player history, JSON events, graph causality,
> vector-ready memories, traces, evals, and training examples.

Proof handle:

- `STWL_GAME_EVENTS`
- `STWL_AGENT_MEMORIES`
- `.codex_tmp/model-ai-readiness/proof-bundle.md`
- [notebook-cta-map.md](notebook-cta-map.md)

Boundary:

> If the smoke receipt says `Vector memories: 0`, say vector memory is enabled,
> not returned for that exact call.

### "Is the AI line impressive enough?"

> It is intentionally conservative. For a live conference, grounded and boring
> beats stylish and invented. Style can improve; the non-negotiable part is that
> the line stays inside recorded evidence and tells us which path produced it.

Proof handle:

- `/paf/api/commentary`
- `.codex_tmp/conference-preflight/latest.md`

Boundary:

> Do not optimize the demo by letting the model invent better drama.

### "What would make this production-grade for a gaming studio?"

> Normalize the event SDK for Unity, Unreal, and web. Store clip manifests in
> object storage with event ids and timecodes. Add moderation, observability,
> cache policy, tenant isolation, human override, replay review, and promotion
> gates. The demo proves the architecture shape, not the whole studio platform.

Proof handle:

- [architecture.md](architecture.md)
- [conference-readiness-scorecard.md](conference-readiness-scorecard.md)

Boundary:

> Demo scale uses telemetry plus replay JSON. It does not claim full broadcast
> video ingestion.

### "What is the most honest caveat today?"

> The game path is green. The AI evidence path is green with boundaries. The
> two-live-private-LLM claim is still gated because both routes currently report
> `runtime_mode=behavior-adapter`.

Proof handle:

- `.codex_tmp/model-ai-readiness/proof-bundle.md`
- `.codex_tmp/conference-stage-brief/latest.md`

Boundary:

> Say the caveat out loud. AI engineers trust systems that refuse to overclaim.

### "How does continual learning work without becoming chaos?"

> You separate the surfaces. Token space is the current prompt and output.
> Structured space is the organized evidence and traces the system can operate
> on. Weight space is stable behavior learned before the turn. Skill space is
> where repeated workflows become governed tools or playbooks. Each promotion
> has a test and a trace.

Proof handle:

- [continual-learning-operating-model.md](continual-learning-operating-model.md)
- `deploy/db/stwl_model_learning.sql`
- `.codex_tmp/model-ai-readiness/proof-bundle.md`

Boundary:

> Do not say the demo auto-updates weights or lets a model self-install skills.
> The production move is gated promotion, not uncontrolled self-modification.

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
