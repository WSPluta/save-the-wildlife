# Save the Wildlife Model AI

This directory holds the private model pieces for the PAF base-vs-fine-tuned demo.

The demo rule is deliberate:

- Facts, score rows, telemetry, evidence, traces, evals, and promotion records stay in Oracle AI Database.
- Fine-tuning trains behavior only: concise commentary shape, evidence citation discipline, calibrated confidence, safe stage tone, and token efficiency.
- The canary harness only proves two live LLMs when both PAF route outputs report `runtime_mode=upstream-llm`.

## Inference Adapter

`model-ai/inference/server.py` exposes the internal PAF endpoint contract:

```json
{
  "trace_id": "trace-id",
  "system": "system prompt",
  "prompt": "commentary prompt",
  "evidence": { "summary": { "player_name": "Ava" } },
  "max_tokens": 120,
  "temperature": 0.2,
  "route_context": {}
}
```

Set `STWL_UPSTREAM_URL` to make the adapter report `runtime_mode=upstream-llm`.

By default, the adapter treats the upstream as OpenAI-compatible chat completions:

```bash
STWL_UPSTREAM_FORMAT=openai
STWL_UPSTREAM_URL=https://<private-endpoint>/v1/chat/completions
```

The OpenAI-compatible payload includes the prompt plus a runtime evidence packet containing the trace ID, Oracle AI Database evidence references, route context, and facts policy. That packet is inference context only; it is not training data and it does not move durable facts into model weights.

If the upstream model service already exposes the same internal PAF contract, use:

```bash
STWL_UPSTREAM_FORMAT=internal
STWL_UPSTREAM_URL=http://<private-endpoint>/commentary
```

Without `STWL_UPSTREAM_URL`, the adapter stays in `behavior-adapter` mode and the strict canary proof gate fails by design:

```bash
STWL_LOAD_REQUIRE_UPSTREAM_LLM=true npm --prefix bots run load:commentary
```

## Behavior Fine-Tuning

`model-ai/training/train_behavior_lora.py` is the OCI Data Science job entrypoint. It accepts JSONL or JSON arrays of behavior traces and converts them into chat training examples with evidence references and hashes instead of durable factual truth.

Export accepted traces from Oracle AI Database:

```bash
npm --prefix private-agent-factory run export:training -- \
  --dataset-version stwl-commentary-v1 \
  --output /tmp/stwl-behavior-v1.jsonl
```

The default export redacts raw prompt text because live prompts can contain mutable game facts. It keeps prompt hashes, evidence hashes, trace IDs, citations, provider metadata, eval scores, and the accepted behavior output. Use `--include-prompt-text` only for audited inspection exports, not for behavior fine-tuning.

Local dry run:

```bash
python3 model-ai/training/train_behavior_lora.py \
  --dataset-uri /tmp/stwl-behavior-v1.jsonl \
  --adapter-uri /tmp/stwl-commentary-adapter \
  --dry-run
```

GPU job shape:

```bash
STWL_BASE_MODEL_ID=<base-model-id> \
STWL_DATASET_URI=oci://<bucket>@<namespace>/datasets/stwl-behavior-v1.jsonl \
STWL_ADAPTER_URI=oci://<bucket>@<namespace>/adapters/stwl-commentary-lora-v1/ \
python /app/train_behavior_lora.py
```

The default `model-ai/training/Dockerfile` remains lightweight so existing DevOps builds stay stable. Use `Dockerfile.gpu` for the bill-impacting OCI Data Science run:

```bash
npx zx scripts/build.mjs model-ai-training-gpu
```

Push the resulting image to OCIR and set `model_ai_training_image_uri` before enabling the Terraform `model_ai_enabled` path.
