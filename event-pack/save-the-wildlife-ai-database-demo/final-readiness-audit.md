# Final Readiness Audit

Generated from the current launch-card proof flow on **2026-06-19 22:36 UTC**.

Use this as the final go/no-go audit before rehearsal or stage. It does not
replace the generated receipts. It maps the objective to the current evidence
and makes the caveats explicit.

## Verdict

**GO WITH CAVEATS.**

The game path is green. The AI evidence path is green with honest boundaries.
The talk track and stage materials are in place. The two-live-private-LLM claim
remains gated until strict upstream proof passes.

## Commands Run

```bash
npm run check:conference-demo:transport
npm run check:conference-demo:game
npm run check:conference-demo
npm run check:conference-demo:stage -- --skip-refresh
```

## Current Receipts

- Stage brief: `.codex_tmp/conference-stage-brief/latest.md`
- Game smoke: `.codex_tmp/conference-game-smoke/latest.md`
- Transport smoke: `.codex_tmp/conference-transport-smoke/latest.md`
- Conference preflight: `.codex_tmp/conference-preflight/latest.md`
- Model proof bundle: `.codex_tmp/model-ai-readiness/proof-bundle.md`

## Requirement Audit

| Requirement | Status | Evidence | Stage-safe claim |
|---|---|---|---|
| Modern interactive app runs on Oracle | Proven | Transport smoke `ready`; game endpoint `200`; OKE service receipts in stage brief | "This is a real-time browser 3D app running on OCI/OKE." |
| Mobile limbic opening works | Proven | Game smoke `ready`; mobile `RUNNING`; joystick `134x134`; waterline contact visible | "The audience can join from phones and create the event stream." |
| Game remains playable on desktop | Proven | Desktop game smoke `RUNNING`; wake ripples visible; waterline contact visible | "The browser experience is live and visually proven." |
| Realtime room lifecycle works | Proven | Transport smoke socket lifecycle pass; room start/end ack present | "Socket.IO room lifecycle is working on the public deployment." |
| Oracle AI Database is the evidence layer | Proven | Preflight match context: SQL source, JSON events, graph facts, coordinates, mechanics | "SQL gives facts; JSON carries flexible payloads; graph explains causality." |
| Powerups, trails, freezes and coordinates are in the story | Proven | Context receipt: shield 1, trail crossings 1, freezes 1, last position `{"x":12.3,"y":0,"z":-4.5}` | "The commentary context is mechanics-aware, not score-only." |
| PAF is deployed and wired | Proven | PAF health pass; version `0.0.4`; Canvas configured; in-db agent enabled; Select AI profile present | "PAF is part of the deployed agent surface." |
| Select AI and in-db agent angle is represented | Proven as configured path | PAF health: `STWL_GAMEPLAY_AI`; in-db agent enabled | "Select AI and in-db agent paths are configured; metadata decides whether a specific line used them." |
| Harness argument is stage-ready | Proven by materials and receipts | Deck, presenter notes, launch card, Q&A, source metadata, fallback, trace persisted | "Agent equals model plus harness; the harness owns evidence, tools, policy, fallback, and trace." |
| Production continual learning story is stage-ready | Prepared | `continual-learning-operating-model.md`, `deploy/db/stwl_model_learning.sql`, model proof bundle, Q&A | "Token space is current context, structured space is governed evidence, weight space is stable behavior, skill space is governed induction." |
| Commentary is bounded and grounded | Proven | Commentary length 83; source `oci-base`; fallback `oracle-sql`; trace persisted | "The line is short, source-tagged, and backed by SQL evidence." |
| Replay and vector story is honest | Gated per smoke call | Receipt shows replay clips `0`; vector memories `0` | "Replay/vector are enabled paths, not returned evidence for this smoke call." |
| Canvas generated exact smoke line | Not proven | Commentary metadata: `canvas:null` | "Canvas is configured; do not claim it produced this exact line." |
| In-db agent generated exact smoke line | Not proven | Commentary metadata: `in_db_agent:null` | "In-db agent is configured; do not claim it produced this exact line." |
| Two private upstream LLM runtimes are live | Not proven | Model proof: adapter ready; strict upstream failed; `behavior-adapter` runtime | "Adapter handoff is live; two-live-LLM claim remains gated." |
| Talk track resonates for AI engineers | Prepared | Deck, deck presenter notes, hard-room Q&A, claim ledger, launch card | "Proof first, claim second. SQL first, LLM last." |
| Notebook CTA is clear | Prepared | `notebook-cta-map.md`, slide 9, presenter notes | "The game is the front door; notebooks are the developer path." |

## Stage Posture

Say:

> The game path is green. The AI path is green with honest caveats. Proof first,
> claim second.

Do not say:

- "The model watched raw gameplay footage."
- "Canvas produced this exact line" while `canvas` is `null`.
- "The in-db agent produced this exact line" while `in_db_agent` is `null`.
- "Replay/vector evidence was returned" when counts are zero.
- "Two private upstream LLMs are live" while strict upstream proof fails.

## Walk-On Pack

Open these before stage:

1. [save-the-wildlife-ai-engineer-demo-deck.pptx](../../outputs/save-the-wildlife-ai-engineer-demo-deck.pptx)
2. [stage-launch-card.md](stage-launch-card.md)
3. [deck-presenter-notes.md](deck-presenter-notes.md)
4. [ai-engineer-qa.md](ai-engineer-qa.md)
5. `.codex_tmp/conference-stage-brief/latest.md`

## Close

> SQL decides what happened. The model decides how to say it. The harness
> decides whether it is allowed to say it.
