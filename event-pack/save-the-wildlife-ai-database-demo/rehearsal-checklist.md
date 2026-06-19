# Rehearsal And Readiness Checklist

## One Day Before

- [ ] Open the game from laptop and phone.
- [ ] Verify the phone joystick appears during gameplay.
- [ ] Run PAF health.
- [ ] Run commentary smoke.
- [ ] Confirm PAF Canvas UI opens.
- [ ] Decide whether to use live audience events or the smoke session for the commentary proof.
- [ ] Put the game URL on a QR slide.
- [ ] Put the three notebook filenames on the CTA slide.
- [ ] Read [ai-engineer-presenter-card.md](ai-engineer-presenter-card.md) out loud once and make the opening land in under 45 seconds.

## Thirty Minutes Before

Run:

```bash
curl -sSI http://130.162.174.167/
curl -sS http://130.162.174.167/paf/healthz
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Check:

- [ ] Game returns `200`.
- [ ] PAF returns `"ok": true`.
- [ ] PAF has `"canvas_configured": true`.
- [ ] PAF has `"indb_agent_enabled": true`.
- [ ] PAF has `"select_ai_profile": "STWL_GAMEPLAY_AI"`.
- [ ] Commentary has `"warning": null`.
- [ ] Commentary summary includes at least one powerup, one trail crossing, one freeze, and coordinates.

## Model AI Phase Preflight

Run:

```bash
npm run check:model-ai-demo
npm run check:model-ai-demo -- --require-upstream-llm
curl -sS http://130.162.174.167/admin/ai-learning | \
  rg "upstream formats openai:2|OpenAI upstream handoff contract|behavior-adapter|LLM proof gate"
```

Check:

- [ ] Default readiness returns `verdict=ready_with_upstream_llm_blocker`.
- [ ] Strict readiness fails until both private routes report `runtime_mode=upstream-llm`.
- [ ] Admin UI shows `upstream formats openai:2`.
- [ ] Admin UI shows `behavior-adapter`.
- [ ] Admin UI shows `LLM proof gate`.
- [ ] You can say this cleanly: **tier-1000 canary proves the harness; upstream runtime gate proves the two LLMs.**

Point to:

- [ ] `Tier 1000 pass`.
- [ ] `High-score test table verified 1000/1000 rows`.
- [ ] `upstream formats openai:2`.
- [ ] `25 live examples`.
- [ ] `Trainer dry-run`.
- [ ] `Promotion held for upstream GPU LLM runtime`.

## Rehearsal Goals

- [ ] Opening is under 45 seconds before asking people to play.
- [ ] Audience play is capped at 2 minutes.
- [ ] Live API proof is under 90 seconds.
- [ ] Harness explanation is under 3 minutes.
- [ ] Notebook CTA is under 90 seconds.
- [ ] Close lands before 18:00.

## What To Memorize

1. The story: **Play -> Prove -> Agent -> Harness -> CTA**.
2. The phrase: **SQL first. LLM last.**
3. The model: **Agent = Model + Harness**.
4. The proof: `warning=null`, `summary` matches recorded SQL evidence, and source metadata tells you the actual path: Canvas, Select AI, in-db agent, model-router adapter, or SQL fallback.
5. The Canvas message: **Business users shape the agent; engineers own the harness.**
6. The Model AI proof: **facts in memory, behavior in weights.**
7. The boundary: **OpenAI-compatible handoff is live; upstream LLM runtime is still pending.**
8. The CTA: game demo is the front door; notebooks are the developer path.
9. The stage line: **Modern AI apps are not one giant prompt. They are live systems with memory, tools, traces, policy, and a model inside a harness.**

## Backup Talk Track

If the live demo fails:

> The important pattern still holds. The game emits events, Oracle AI Database stores them, SQL creates the evidence package, and the harness controls what the model can say. I have a seeded smoke session so we can prove the path without depending on live room traffic.

Then run the smoke commentary command.

## Red Flags

- Do not let audience play consume more than 2:30.
- Do not show raw notebook code unless asked.
- Do not over-explain OCI deployment.
- Do not let PAF Canvas become the whole story. The broader story is Canvas plus the harness around governed data and live systems.
- Do not call this "just a chatbot." It is an agent workflow grounded in database events.
- Do not say two live LLMs are running until strict upstream readiness passes.
- Do not start GPU/Data Science spend during rehearsal unless that has been explicitly approved.
