# Source Map

Use this to answer technical follow-up questions.

## Live Deployment

| Claim | Source |
|---|---|
| Game is live | `http://130.162.174.167/` |
| PAF is live behind `/paf` ingress | `deploy/k8s/base/ingress/paf-ingress.yaml` |
| PAF is deployed as OKE workload | `deploy/k8s/base/private-agent-factory/private-agent-factory.yaml` |
| PAF service has health endpoint | `private-agent-factory/index.js` |
| PAF env wires Oracle, GenAI, Canvas, Select AI | `deploy/k8s/base/private-agent-factory/application.env.template` |
| PAF exposes match-intelligence context | `GET/POST /api/context` in `private-agent-factory/index.js` |

## Gameplay Telemetry

| Claim | Source |
|---|---|
| Supported event stream includes powerups, trail crossings, freezes | `server/lib/gameEvents.js` |
| Oracle table stores session, room, player, event, timestamp, score, coordinates, related IDs, metadata | `deploy/db/stwl_game_events.sql` |
| Telemetry insert uses explicit sequence for live ADB compatibility | `server/lib/gameEvents.js` |
| Mobile joystick is present and tested | `web/src/script.js`, `web/src/style.css`, `web/src/__tests__/mobileControls.test.js` |
| Browser captures replay JSON around key moments | `triggerReplayMoment` in `web/src/script.js` |
| Replay service stores JSON clips and clip manifests | `replay/src/main/java/com/oracle/developer/multiplayer/replay/api/ReplayController.java` |

## Commentary Runtime

| Claim | Source |
|---|---|
| Runtime reads Oracle SQL summary first | `private-agent-factory/index.js`, `deploy/db/stwl_commentary_pkg.sql` |
| Summary includes powerups, trail crossings, freezes, coordinates, and prior best | `deploy/db/stwl_commentary_pkg.sql` |
| Context includes SQL events, graph facts, replay clips, and vector-ready memories | `buildMatchContext` in `private-agent-factory/index.js` |
| Replay captions require recorded replay evidence | `buildEvidenceFormats` in `private-agent-factory/index.js` |
| In-db agent team path is attempted | `DBMS_CLOUD_AI_AGENT.RUN_TEAM` in `deploy/db/stwl_commentary_pkg.sql` |
| Select AI fallback is used | `DBMS_CLOUD_AI.GENERATE` in `deploy/db/stwl_commentary_pkg.sql` |
| Deterministic fallback exists | `deterministic_script` in `deploy/db/stwl_commentary_pkg.sql` |
| Profanity and 200-character guard exist | `clamp_text` in `deploy/db/stwl_commentary_pkg.sql`; `enforceCommentary` in `private-agent-factory/index.js` |
| PAF Canvas final phrasing is used | `callPafCanvas` and `buildCommentary` in `private-agent-factory/index.js` |
| Output formats include live line, replay caption, recap, and clip title | `outputFormat`, `buildEvidenceFormats` in `private-agent-factory/index.js` |

## Match Intelligence Data Model

| Claim | Source |
|---|---|
| SQL event ledger remains authoritative | `deploy/db/stwl_game_events.sql` |
| JSON event documents are exposed for agent context | `STWL_EVENT_DOCUMENTS` in `deploy/db/stwl_match_intelligence.sql` |
| Graph-ready player/session/item relationships are exposed | `STWL_GRAPH_VERTICES`, `STWL_GRAPH_EDGES` in `deploy/db/stwl_match_intelligence.sql` |
| Replay clips are indexed by session/player/event/timecode | `STWL_REPLAY_CLIPS` in `deploy/db/stwl_match_intelligence.sql` |
| Vector-ready memories support similar-moment retrieval | `STWL_AGENT_MEMORIES` in `deploy/db/stwl_match_intelligence.sql` |

## Select AI Setup

| Claim | Source |
|---|---|
| Resource principal is enabled before profile creation | `deploy/db/select_ai_profile_template.sql` |
| Select AI profile is `STWL_GAMEPLAY_AI` | `deploy/db/select_ai_profile_template.sql` |
| Profile scopes to gameplay tables/views | `STWL_GAME_EVENTS`, `STWL_SESSION_SUMMARY` in `deploy/db/select_ai_profile_template.sql` |
| Profile scopes to match-intelligence objects | `STWL_EVENT_DOCUMENTS`, `STWL_GRAPH_*`, `STWL_REPLAY_CLIPS`, `STWL_AGENT_MEMORIES` |
| Presenter Select AI prompts are included | `deploy/db/select_ai_profile_template.sql` |

## Tests

| Claim | Source |
|---|---|
| PAF commentary path is unit tested | `private-agent-factory/test/commentary.test.js` |
| PAF tests cover Canvas, Select AI, in-db agent, context, replay gating, fallback, SQL assets | `private-agent-factory/test/commentary.test.js` |
| Event validation and persistence shape are tested | `server/test/gameEvents.test.js` |
| Mobile joystick behavior is tested | `web/src/__tests__/mobileControls.test.js` |

## Production Memory Patterns

Use this section when the audience asks how the game pattern becomes a real enterprise agent system.

| Claim | Source |
|---|---|
| Tenant scope is structurally different from user, agent, and thread scope | [production-agent-memory-patterns.md](production-agent-memory-patterns.md); source draft: *From Prompt to Persistence: Designing Multi-Tenant Agent Memory Schemas for SaaS* |
| Row-level policy should enforce tenant boundaries below the model | [production-agent-memory-patterns.md](production-agent-memory-patterns.md); production pseudocode adapted from the multi-tenant memory draft |
| Memory should be typed before retrieval | [production-agent-memory-patterns.md](production-agent-memory-patterns.md); source draft: *From RAG to Memory Systems: Building Stateful AI Architecture* |
| Structured rows are truth and vector indexes are acceleration | [production-agent-memory-patterns.md](production-agent-memory-patterns.md) |
| Promotion gates decide which traces become durable memory or training examples | [production-agent-memory-patterns.md](production-agent-memory-patterns.md); `STWL_MODEL_TRACES`, `STWL_MODEL_EVALS`, `STWL_TRAINING_EXAMPLES` |
| Context should be reassembled every turn rather than accumulated forever | [production-agent-memory-patterns.md](production-agent-memory-patterns.md) |

## Model AI Proof Matrix

Use this section when an AI engineer asks what is proven live versus what is still intentionally gated.

One-command local proof bundle:

```bash
npm run check:model-ai-demo:proof
```

It writes `.codex_tmp/model-ai-readiness/proof-bundle.md` after running adapter-mode, strict-upstream, then adapter-mode again.

| Claim | Current verdict | Proof receipt |
|---|---|---|
| PAF/Oracle AI Database harness is live | Proven | `npm run check:model-ai-demo:proof`; `/admin/ai-learning`; `private-agent-factory/index.js` |
| Tier-1000 adapter-mode canary passed | Proven | `output/prod-load/202606132052-fastpath-full/summary.md`; admin proof `Tier 1000 pass` |
| Every tier-1000 player wrote a high-score test row | Proven | Admin proof `Score proof 1000/1000`; load report high-score row verification |
| Commentary remained unique at tier 1000 | Proven | Load report duplicate check `0`; admin proof `0 duplicates` |
| Base versus fine-tuned shadow route metadata exists | Proven | `PAF_PRIMARY_MODEL_PROVIDER=oci-base`; `PAF_CANDIDATE_MODEL_PROVIDER=oci-fine-tuned`; admin comparison panel |
| Both private routes expose an OpenAI-compatible handoff | Proven | `npm run check:model-ai-demo`; private adapter health note `upstream formats openai:2`; admin proof `OpenAI upstream handoff contract` |
| Behavior-only training examples can be exported | Proven | `.codex_tmp/stwl-behavior-v1-live.jsonl`; admin proof `25 live examples` |
| QLoRA trainer accepts the behavior-only dataset shape | Proven by dry-run | `model-ai/training/train_behavior_lora.py --dry-run`; admin proof `Trainer dry-run ok=true` |
| Two live private LLM runtimes are serving responses | Blocked | `npm run check:model-ai-demo:strict` must pass before this claim is allowed |
| Fine-tuned model is promotion-ready | Blocked | Promotion requires both routes to report `runtime_mode=upstream-llm` plus strict canary and eval gates |

Strict upstream proof command:

```bash
npm run check:model-ai-demo:strict
```

Expected until upstream LLM runtimes are attached:

- `verdict=failed`
- failure reason includes `runtime_mode=behavior-adapter`
- strict receipt is preserved at `.codex_tmp/model-ai-readiness/strict-upstream.md`
- adapter-mode receipt is preserved at `.codex_tmp/model-ai-readiness/adapter-mode.md`

Safe presenter sentence:

> Tier 1000 proves the harness; `upstream formats openai:2` proves the private handoff; strict upstream mode is the gate that will prove two live LLMs.

## Conference Preflight Command

Use this before rehearsal or stage time:

```bash
npm run check:conference-demo
npm run check:conference-demo:game
```

The first command writes `.codex_tmp/conference-preflight/latest.md` and checks:

- live game URL
- PAF health flags
- Oracle match-intelligence context
- commentary length, profanity, source metadata, trace persistence, and runtime-mode boundary
- model AI proof bundle

The second command writes `.codex_tmp/conference-game-smoke/latest.md` and checks:

- public mobile gameplay reaches `RUNNING`
- touch joystick is visible and usable
- opening trash is not spawned directly on the player
- item counts remain healthy
- boat waterline contact remains visible
- desktop movement produces wake ripples

Expected current presenter verdict is `ready_with_caveats`, because the smoke session may not return replay/vector evidence and the model routes still report `runtime_mode=behavior-adapter`. That is acceptable and should be presented as the honest boundary, not hidden.

## Notebook Story Sources

| Talk point | Notebook |
|---|---|
| Agent = Model + Harness | *Enterprise Data Agent (Heavyweight)*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Scenario-first harness design | *Enterprise Data Agent (Heavyweight)*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Semantic tool retrieval and skillbox | *Enterprise Data Agent (Heavyweight)*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Tool-output offload | *Enterprise Data Agent (Heavyweight)*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Identity-aware authorization | *Enterprise Data Agent (Heavyweight)*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Memory types and context engineering | *Memory and Context Engineering for Agents*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Programmatic vs agentic memory operations | *Memory and Context Engineering for Agents*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Long-conversation memory comparison | *Oracle Agent Memory for Long Conversations*; see [notebook-cta-map.md](notebook-cta-map.md) |
| Scoped retrieval does not leak | *Oracle Agent Memory for Long Conversations*; see [notebook-cta-map.md](notebook-cta-map.md) |

## Technical Sound Bites With Proof

| Sound bite | Proof |
|---|---|
| SQL decides what happened. The model decides how to say it. | `session_summary_json`, `select_ai_script`, `callPafCanvas` |
| The game is the wrapper; the event stream is the product. | `GAME_EVENT_TYPES`, `stwl_game_events` |
| Telemetry explains what happened. Replay shows it. Oracle AI Database connects both. | `stwl_game_events`, `stwl_replay_clips`, `/paf/api/context` |
| Graph explains relationships. Vector finds similar moments. | `stwl_graph_edges`, `stwl_agent_memories` |
| The harness is where agent quality becomes engineering. | notebooks plus PAF runtime fallback chain |
| Scoped retrieval is not safe until you prove it does not leak. | long-conversation notebook exercise |
