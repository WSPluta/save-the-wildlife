# Save the Wildlife Model AI Weekend Talk Track

## Current Demo Truth

Use this as the anchor before any deeper AI discussion:

- The live canary endpoint is `http://130.162.174.167`.
- The AI learning admin page is `http://130.162.174.167/admin/ai-learning`.
- The PAF route is live in shadow mode: `oci-base -> oci-fine-tuned`.
- Oracle AI Database is the evidence and memory layer: game facts, score proof, traces, outputs, evals, training examples, and promotion records stay inspectable.
- The load gate now passes tiers `5, 10, 50, 100, 500, 1000`.
- The current model endpoints are private OKE behavior adapters, not yet GPU-backed upstream LLMs.
- Say this plainly: the harness and proof path are real through tier 1000; the next proof is swapping the adapters to private upstream vanilla and fine-tuned LLM runtime.

## One-Sentence Thesis

Do not fine-tune changing facts into an agent; keep facts in Oracle AI Database memory and use fine-tuning to compress stable behavior: concise commentary, evidence citation, confidence discipline, and tool-use shape.

## The Demo Arc

1. Start with the game, not a diagram.
   - "This is a multiplayer workload. Every player join, score, and game-over event creates operational data."
   - "The AI part is not decorative. It has to produce per-player commentary after the match, and it has to do it under load."

2. Show the admin evidence page.
   - Open `/admin/ai-learning`.
   - Point to `Tier 1000 pass`.
   - Point to `High-score test table verified 1000/1000 rows`.
   - Point to `oci-base -> oci-fine-tuned`.
   - Point to `Promotion held for upstream GPU LLM runtime`.

3. Explain the harness split.
   - "Agent equals model plus harness."
   - "The model emits tokens. The harness owns memory, retrieval, tool calls, budgets, trace IDs, evals, fallback labels, and promotion gates."
   - "That is why the demo can fail honestly. We had a tier-500 failure where 411 responses fell back before model metadata arrived. The gate caught it instead of hiding it."

4. Explain the fast-path fix.
   - "The first path waited too long on optional enrichment. Under 500 players, the websocket server fell back before PAF metadata arrived."
   - "The fix was to route live commentary directly through the private model path first, then use slower Canvas or Select AI enrichment only when the budget allows."
   - "After that, 500 and 1000 passed with full trace and model metadata."

5. Explain the model comparison.
   - "Primary is `oci-base`; candidate is `oci-fine-tuned`."
   - "The candidate is shadowed, evaluated, and recorded without taking production output by default."
   - "Promotion requires no loss of groundedness or confidence, and improvement in quality or token efficiency."

6. Explain why Oracle AI Database is the memory layer.
   - "Changing facts need update, delete, scope, citation, and audit paths."
   - "A converged database matters because retrieval for agents must be fresh, governed, and joined across relational, JSON, graph, vector, and text evidence."
   - "The interesting claim is not just multi-model storage. It is one transaction boundary, one optimizer, one consistency model, and one governance domain."

## Five-Minute Script

Here is the version to practice.

> I want to show a model demo, but not the usual model demo where the model is treated like the whole system.
>
> This is Save the Wildlife, a multiplayer workload. Players join rooms, play matches, collect points, and write score rows. At the end, every player gets a short AI commentary line.
>
> The important part is that the commentary is not allowed to be vibes. It has to come from the game evidence path. We track joins, score rows, commentary latency, duplicate text, source counts, model route metadata, and promotion verdicts.
>
> The thesis is simple: changing facts belong in memory; fine-tuning belongs in behavior. Game facts, score rows, trace IDs, prompts, evidence hashes, evals, and training examples stay in Oracle AI Database. The model comparison is about behavior: concise output, evidence use, confidence discipline, and token efficiency.
>
> In PAF, the primary provider is `oci-base`, and the candidate is `oci-fine-tuned`. We run them in shadow mode. The base output is used, the candidate is evaluated, and both outputs are persisted with trace metadata. If the candidate is more efficient or better without losing groundedness, it can become promotion-ready. If it loses groundedness, we hold it.
>
> The demo has a real failure story. At tier 500, before the fast path, all 500 players joined and all 500 score rows were written, but 411 responses fell back to deterministic server commentary before model metadata arrived. The strict gate rejected it. That is exactly what an agent harness should do.
>
> The fix was not to relax the gate. We changed the harness so live commentary goes to the private model route first, before optional slow enrichment. After that, the full canary sequence passed: 5, 10, 50, 100, 500, and 1000 players. At 1000, we verified 1000 joins, 1000 high-score rows, 1000 commentary events, zero duplicate commentary, and p95 commentary latency around 2.4 seconds.
>
> The honest caveat is this: the private endpoints are currently behavior adapters in OKE. The route, metadata, load gates, evals, and Oracle AI Database learning tables are live. The next proof is to attach private upstream GPU-backed vanilla and fine-tuned LLM deployments, then rerun the same canary gates. That is the right standard: do not claim the fine-tune won until the harness proves it.

## Ten-Minute Technical Walkthrough

### 1. Live Evidence

Show:

```bash
curl -sS http://130.162.174.167/paf/healthz | jq '.model_router'
```

Expected points:

- `route_mode`: `shadow`
- `primary_provider`: `oci-base`
- `candidate_provider`: `oci-fine-tuned`
- `base_endpoint_configured`: `true`
- `fine_tuned_endpoint_configured`: `true`
- `fast_path_enabled`: `true`
- `trace_persist`: `true`
- `eval_enabled`: `true`

Then show:

```bash
cat output/prod-load/202606132052-fastpath-full/summary.md
```

Call out:

- Tier 1000 passed.
- `1000/1000` joined.
- `1000/1000` high-score rows.
- `1000/1000` commentary.
- `0` duplicates.
- p95 `2420 ms`.
- Source `oci-base`.
- Route `oci-base->oci-fine-tuned`.
- Runtime `behavior-adapter`.

### 2. PAF Router

Say:

- "The router is not just a provider switch. It is a trace boundary."
- "Every response carries route mode, primary and candidate providers, model ID, latency, prompt hash, evidence hash, eval scores, and promotion verdict."
- "The websocket server passes that metadata through `commentary.ready`, and the load harness gates on it."

### 3. Continuous Learning Tables

Say:

- `STWL_MODEL_TRACES` stores prompt/evidence lineage and player/session/run IDs.
- `STWL_MODEL_OUTPUTS` stores base and candidate output text, provider, latency, tokens, status, and model ID.
- `STWL_MODEL_EVALS` stores rubric scores and verdicts.
- `STWL_TRAINING_EXAMPLES` captures accepted behavior traces, not durable truth.
- `STWL_MODEL_PROMOTIONS` stores candidate approval state.

The phrasing to remember:

> The adapter is not the production asset. The production asset is the governed trace loop: memory, evidence, evals, training examples, and promotion gates.

### 4. Why This Matters to AI Engineers

The core engineering argument:

- Fine-tuning facts makes them hard to inspect, hard to correct, and slow to forget.
- Retrieval without governance can produce stale or unauthorized context.
- Agent quality depends on the harness: retrieval, memory, tool control, time budgets, trace persistence, eval gates, and fallback labeling.
- Oracle AI Database is valuable here because the memory layer can keep operational facts fresh, governed, and joined.

Use this line:

> A fine-tune should make the model better at using memory, not pretend memory is unnecessary.

## Demo Click Path

1. Open `http://130.162.174.167/admin/ai-learning`.
2. Show `Player Join and Commentary Evaluation`.
3. Point to `Tier 1000 pass`.
4. Point to the old failed row: `411 deterministic fallback responses`.
5. Point to the recovery rows: tier 500 and tier 1000 passed after fast path.
6. Scroll to `Continuous Learning Evidence`.
7. Point to `Facts in memory, behavior in weights`.
8. Point to primary/candidate providers.
9. Point to `behavior-adapter`.
10. Say the next stage is private upstream GPU runtime, not a new harness.

## Questions You Should Be Ready For

**Is this really fine-tuned yet?**

Not yet in the live runtime. The PAF route, shadow comparison, evals, traces, admin evidence, and canary gates are live. The current private endpoints are behavior adapters. The next step is to attach real private upstream vanilla and fine-tuned LLM endpoints behind those adapters and rerun the same gates.

**Why show this before the GPU model is live?**

Because the harness is the harder production story. Without trace IDs, evidence hashes, evals, fallback labels, score-row proof, and strict gates, a fine-tuned model demo is just a nicer string generator. This proves the system can judge the model comparison.

**Why not fine-tune the game facts?**

Because game facts change. Scores, rooms, players, telemetry, prompts, evidence, and evals need to be queryable, correctable, scoped, deleted, and audited. Those are database responsibilities.

**What does the fine-tune learn?**

Behavior: concise commentary shape, evidence citation, calibrated confidence, safe wording, and tool-use format. The candidate should use fewer tokens or produce better commentary without losing groundedness.

**Why Oracle AI Database instead of a vector-only store?**

The agent needs current operational state, relational joins, JSON events, graph or replay context, vector memories, SQL evidence, and access control in one governed layer. Similarity search is a feature; the agent needs a memory system.

**What did the tier-500 failure prove?**

It proved the gate was real. The system did not accept deterministic fallback as success. It preserved the failure reason, fixed the harness path, and then passed 500 and 1000 with full model metadata.

## Next Engineering Step

Attach real upstream LLM runtime behind the existing private endpoints:

1. Deploy a private vanilla/base model endpoint.
2. Train or attach a LoRA/QLoRA behavior adapter for the candidate.
3. Configure `stwl-base-commentary` and `stwl-ft-commentary` with upstream URLs.
4. Keep `runtime_mode=upstream-llm` visible in PAF metadata.
5. Rerun `STWL_LOAD_TIERS=5,10,50,100,500,1000`.
6. Promote only if groundedness and confidence stay green and the candidate improves quality or token efficiency.

## Source Material Incorporated

- `/Users/wojtekpluta/Downloads/stop-fine-tuning-facts-into-your-agent.docx`
- `/Users/wojtekpluta/Downloads/what-is-a-converged-database-v3/01-what-is-a-converged-database.md`
- Live report: `output/prod-load/202606132052-fastpath-full/summary.md`
- Live admin route: `http://130.162.174.167/admin/ai-learning`
