# Conference Readiness Scorecard

Use this as the final go/no-go document for the AI engineer conference. It is deliberately practical: run the commands, inspect the receipts, decide what is safe to claim, then present with confidence.

## Current Decision

**GO only when the generated stage brief is green or caveated-green.**

The demo is ready when these commands return the expected posture:

```bash
npm run check:conference-demo:stage
npm run check:conference-demo:transport
npm run check:conference-demo:game
npm run check:conference-demo
npm run check:model-ai-demo:proof
```

Expected:

- Stage brief: `go`, `go_with_caveats`, or `go_with_local_proof_blocker`
- Transport smoke: `ready` when using it as live transport proof
- Game smoke: `ready`
- Conference preflight: `ready_with_caveats` or better
- Model proof: `adapter_verdict=ready_with_upstream_llm_blocker`
- Strict upstream: `failed`, with the blocker expected until both private routes report `runtime_mode=upstream-llm`

That is the right stage posture. The transport path works, the visual/mobile game path is proven by game smoke or manual visual proof, the Oracle AI Database evidence path works, the harness is traceable, and the strict two-live-LLM claim remains gated.

## Readiness Matrix

| Area | Status | Evidence | Stage use |
|---|---|---|---|
| Limbic opening | GO WHEN VISUAL PROOF IS CURRENT | `.codex_tmp/conference-game-smoke/latest.md` or [manual-visual-proof.md](manual-visual-proof.md) shows mobile `RUNNING`, joystick visible, healthy item counts, safe start buffer, and boat-waterline contact | Start with phones only after visual proof is current. Let the audience create the data before showing architecture. |
| Modern app on Oracle | GO WITH TRANSPORT PROOF | Public game endpoint, `.codex_tmp/conference-transport-smoke/latest.md`, OKE deployment receipts, [architecture.md](architecture.md), [source-map.md](source-map.md) | Say this is a browser 3D app on OCI/OKE with Socket.IO, Coherence, and services. Say mobile-playable when visual proof is current. |
| Oracle AI Database match intelligence | GO | `.codex_tmp/conference-preflight/latest.md`, `/paf/api/context`, SQL/JSON/graph/vector/replay assets in [source-map.md](source-map.md) | Say SQL gives facts, JSON carries flexible events, graph explains relationships, and vector memory is available when history exists. |
| PAF and Canvas story | GO WITH BOUNDARY | `/paf/healthz`, PAF deployment manifests, `canvas_configured=true`, response metadata in preflight | Say Canvas is configured as the business-facing agent surface. Do not say Canvas produced a specific line unless metadata proves it. |
| Commentary and safety | GO | `/paf/api/commentary`, preflight length/source/fallback/trace checks | Say the harness constrains the line: under 200 characters, source metadata, SQL fallback, trace persisted. |
| Agent harness argument | GO | [claim-ledger.md](claim-ledger.md), [ai-engineer-presenter-card.md](ai-engineer-presenter-card.md), `.codex_tmp/model-ai-readiness/proof-bundle.md` | Land `Agent = Model + Harness`. The model emits tokens; the harness owns evidence, tools, memory, fallback, policy, trace, and broadcast. |
| Model AI proof | GO WITH BOUNDARY | Tier-1000 canary, score rows, no duplicate commentary, OpenAI-compatible adapter handoff, strict upstream gate | Say tier 1000 proves the harness and handoff. Do not claim two live private LLM runtimes until strict upstream passes. |
| Notebook CTA | GO | [notebook-cta-map.md](notebook-cta-map.md) | The game is the front door. The notebooks are the developer path into harness, memory, and long-conversation patterns. |

## Go / No-Go Rules

**Go** if:

- `check:conference-demo:game` is `ready`.
- `check:conference-demo:transport` is `ready`.
- `check:conference-demo` is `ready_with_caveats` or better.
- `check:conference-demo:stage` is `go`, `go_with_caveats`, or `go_with_local_proof_blocker`.
- `/paf/healthz` is healthy.
- Commentary response has `warning:null`, is under 200 characters, and includes source metadata.
- You are comfortable saying the current caveats out loud.

**Do not go live-first** if:

- The game endpoint fails.
- The transport smoke fails.
- Mobile smoke does not reach `RUNNING` and you have not completed [manual-visual-proof.md](manual-visual-proof.md) from a normal browser.
- PAF health fails.
- Commentary response has no trace/source metadata.
- The smoke line contradicts recorded SQL facts.
- You cannot open the claim ledger and explain the caveats in under 30 seconds.

If one of those fails, use the seeded smoke session and switch to API proof:

```bash
curl -sS http://130.162.174.167/paf/healthz
curl -sS -X POST http://130.162.174.167/paf/api/context \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

## The 18-Minute Path

1. **0:00-0:45: Opening**

   > Before I show you architecture, I want you to create the data.

2. **0:45-2:30: Audience Play**

   Let people move, collect trash, grab powerups, and cross trails. Do not over-explain yet.

3. **2:30-5:45: Prove The Event Stream**

   Show that gameplay creates coordinates, collisions, powerups, trail crossings, freezes, and scores. Then show Oracle AI Database as the match-intelligence layer.

4. **5:45-9:30: Commentary And Architecture**

   Show `/paf/api/context`, `/paf/api/commentary`, and the metadata. Then explain OKE, Coherence, services, Oracle AI Database, PAF, Canvas, and the harness.

5. **9:30-14:30: Harness And Model Proof**

   Use `Agent = Model + Harness`. Then show the model proof bundle: tier 1000, score-row proof, adapter handoff, training export, and strict upstream boundary.

6. **14:30-18:00: Notebook CTA And Close**

   Send AI engineers to the harness, memory/context, and long-conversation notebooks.

## The Message That Should Land

Use this as the north star:

> The useful claim is not that Oracle can host a game. The useful claim is that a modern interactive app can run on Oracle and keep its AI layer close to governed operational truth.

Then repeat the engineering model:

> Modern AI apps are not one giant prompt. They are live systems with memory, tools, traces, policy, and a model inside a harness.

## Boundaries To Say Out Loud

- The model does not watch raw gameplay footage.
- Replay captions only claim clip/timecode evidence when a replay document exists.
- Vector memories are an enabled path; only claim returned memories when the receipt shows them.
- Canvas is configured; only claim Canvas produced a specific line when response metadata proves it.
- Adapter-mode proof does not prove two live private LLM runtimes.

These caveats are not weakness. They are the standard AI engineers should expect from a production-shaped agent demo.
