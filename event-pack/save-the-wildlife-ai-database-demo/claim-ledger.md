# Stage Claim Ledger

Use this when the room gets technical. It maps each stage claim to the receipt that proves it, the safe sentence, and the boundary. The goal is not to sound defensive. The goal is to make the proof easy to inspect.

Run these before rehearsal or stage time:

```bash
npm run check:conference-demo
npm run check:conference-demo:transport
npm run check:conference-demo:game
npm run check:conference-demo:stage
npm run check:model-ai-demo:proof
npm run check:paf-canvas-mcp
```

Open these receipts:

- `.codex_tmp/conference-game-smoke/latest.md`
- `.codex_tmp/conference-transport-smoke/latest.md`
- `.codex_tmp/conference-stage-brief/latest.md`
- `.codex_tmp/conference-preflight/latest.md`
- `.codex_tmp/model-ai-readiness/proof-bundle.md`
- `.codex_tmp/paf-canvas-mcp-proof/latest.md`
- [source-map.md](source-map.md)

## Current Presenter Posture

The short version:

> The stage brief is the authority. Transport only proves the deployed app and Socket.IO lifecycle when its receipt is ready. The visual game claim needs game-smoke or manual visual proof. The AI path is ready with honest caveats, and the two-live-LLM claim remains gated until strict upstream runtime passes.

Do not turn `ready_with_caveats` into a problem. For AI engineers, the caveat is part of the trust story.

## Claim Ledger

| Claim | What proves it | Safe sentence | Do not say |
|---|---|---|---|
| A modern interactive app is running on Oracle infrastructure | `npm run check:conference-demo:transport`; game endpoint `200`; `.codex_tmp/conference-transport-smoke/latest.md`; deployment receipt in [README.md](README.md) | "This is a real-time browser 3D app running on OCI and OKE, not a form over a table." | "The AI quality is proven because the game loads." |
| The mobile opening works | Mobile section of `.codex_tmp/conference-game-smoke/latest.md` or [manual-visual-proof.md](manual-visual-proof.md): `RUNNING`, joystick visible, healthy item counts, safe nearest-trash buffer, boat-waterline contact | "The phone path is part of the demo, and I only claim it when the visual receipt or manual browser check proves it." | "Every phone and network condition is guaranteed." |
| The game creates real telemetry | `/paf/api/context`; `server/lib/gameEvents.js`; `deploy/db/stwl_game_events.sql`; [source-map.md](source-map.md) | "The audience creates coordinates, collisions, powerups, trail crossings, freezes, and scores." | "The model watched raw gameplay footage." |
| Oracle AI Database is the match-intelligence layer | `.codex_tmp/conference-preflight/latest.md`; `/paf/api/context`; `deploy/db/stwl_match_intelligence.sql`; `deploy/db/stwl_commentary_pkg.sql` | "SQL gives the facts, JSON carries flexible payloads, graph explains relationships, and vector memory is available when similar moments exist." | "Replay or vector evidence exists for this smoke call when the receipt says `0`." |
| Commentary is grounded and bounded | `/paf/api/commentary`; `.codex_tmp/conference-preflight/latest.md`: length, warning, source, fallback, runtime mode, trace persisted | "The sentence is short because the harness applies policy and evidence boundaries." | "The line is safe because the model promised it." |
| Canvas and PAF are part of the deployed agent surface | `/paf/healthz`; `deploy/k8s/base/private-agent-factory/private-agent-factory.yaml`; `deploy/k8s/base/ingress/paf-ingress.yaml`; [architecture.md](architecture.md) | "Canvas is the business-facing agent surface; the deployed harness connects it to governed gameplay evidence." | "Canvas produced this exact line" unless the response metadata proves it. |
| PAF Canvas can read live gameplay data through MCP | `npm run check:paf-canvas-mcp`; `/paf/mcp`; `manifests/private-agent-factory/save-the-wildlife-commentary-canvas-flow.json`; `scripts/import_paf_canvas_flow.py` | "The Canvas flow has a read-only MCP tool surface backed by the same Oracle AI Database telemetry." | "The current public deployment has MCP" until the receipt is ready. |
| Select AI and in-database agents are part of the Oracle AI Database story | `/paf/healthz`; `deploy/db/select_ai_profile_template.sql`; `deploy/db/stwl_commentary_pkg.sql`; [demo-runbook.md](demo-runbook.md) | "Select AI is the presenter-facing natural-language path; runtime summaries stay deterministic first." | "Runtime depends on vague LLM SQL generation." |
| The harness is the engineering pattern | [ai-engineer-presenter-card.md](ai-engineer-presenter-card.md); [source-map.md](source-map.md); `.codex_tmp/model-ai-readiness/proof-bundle.md` | "Agent equals model plus harness. The model emits tokens; the harness owns tools, memory, policy, fallback, trace, and live broadcast." | "One big prompt is the architecture." |
| The production memory pattern is tenant-scoped and typed | [production-agent-memory-patterns.md](production-agent-memory-patterns.md); [source-map.md](source-map.md) | "The demo uses room/session scope; the production pattern adds tenant-scoped typed memory, row-level policy, promotion gates, and context cards." | "The current game tenancy has full multi-tenant RLS installed" unless separately verified. |
| Scale and model-route proof exist | `.codex_tmp/model-ai-readiness/proof-bundle.md`; `/admin/ai-learning`; `npm run check:model-ai-demo:proof` | "Tier 1000 proves the harness and adapter handoff. Strict upstream is the gate for the two-live-LLM claim." | "Two live private LLM runtimes are serving" until strict upstream passes. |
| This is a production-shaped gaming template | [architecture.md](architecture.md); [source-map.md](source-map.md); replay and match-intelligence tables | "The production path pairs telemetry with event-aligned clip manifests and governed memory." | "The demo ingests and summarizes raw unbounded video." |
| The notebooks are CTAs, not stage proof | [notebook-cta-map.md](notebook-cta-map.md) | "The game is the front door; the notebooks are the developer path into harness, memory, and long-conversation patterns." | "The notebooks are required for the live game path to work." |

## Challenge Responses

**"Is this actually live?"**

Open `.codex_tmp/conference-stage-brief/latest.md`.

> The transport receipt proves the public app and Socket.IO lifecycle. The visual receipt proves mobile/desktop play when the game smoke is ready. If browser automation is blocked, I use manual visual proof and say that explicitly.

**"Where is the data coming from?"**

Open `.codex_tmp/conference-preflight/latest.md`.

> The context call reads Oracle match intelligence. For the seeded smoke session it shows Ada, score 42, shield, trail crossing, freeze, coordinates, JSON events, and graph facts.

**"Did Canvas generate that sentence?"**

Open the commentary section in `.codex_tmp/conference-preflight/latest.md`.

> The response metadata is the authority. If it says `canvas:null`, I say Canvas is configured and the harness path is live. I do not claim Canvas produced that exact sentence.

**"Are the base and fine-tuned models both live?"**

Open `.codex_tmp/model-ai-readiness/proof-bundle.md`.

> Adapter mode proves the harness, tier-1000 canary, score-row proof, trace/eval metadata, training capture, and OpenAI-compatible handoff. The two-live-LLM claim waits for `runtime_mode=upstream-llm` on both routes and a passing strict canary.

**"Why Oracle AI Database here?"**

Use the database argument, not a brand slogan:

> Agent memory is not just vectors. This demo needs SQL facts, JSON event documents, graph relationships, vector-ready memory, replay metadata, traces, evals, identity boundaries, and deterministic fallback. Keeping that close to governed operational data is the point.

## Lines To Memorize

- "SQL first. LLM last."
- "The game is the wrapper. The event stream is the product."
- "Telemetry explains what happened. Replay shows it. Oracle AI Database connects both."
- "Canvas shapes the experience. The harness owns the truth."
- "The model decides how to say it. The harness decides whether it is allowed to say it."
