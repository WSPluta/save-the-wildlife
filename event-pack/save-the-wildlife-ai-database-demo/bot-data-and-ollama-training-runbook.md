# Bot Data And Ollama Training Runbook

Use this when the AI engineer audience asks how the commentator gets better
after the demo traffic starts flowing.

## What Changed

- `bots` is now a deployed OKE workload, not a local-only helper.
- Deployed bots join `ROOM-0001`, stay present even when humans join, and emit
  mechanics-rich gameplay evidence.
- Bot evidence includes position samples, item collisions, powerups, trail
  crossings, freezes, and game-over events with `source=bot_simulation`
  metadata.
- PAF keeps accepted commentary traces in Oracle AI Database as behavior
  training examples.
- The private model adapter can call a secure A10-hosted Ollama endpoint using
  the native `/api/chat` contract.

## Stage-Safe Story

Say:

> Bots keep the demo warm. They are not pretending to be humans; they are data
> producers. They create enough recorded mechanics for the commentary harness to
> evaluate, export, and improve behavior without training changing facts into
> the model.

Then make the boundary clear:

> The facts stay in Oracle AI Database. The fine-tune learns behavior: concise
> phrasing, evidence discipline, safety, and fallback style.

## Deployed Bot Path

The DevOps build now produces a `bots` container artifact and the deploy stage
rolls out `deploy/bots`.

Important defaults:

```bash
BOT_ROOM_ID=ROOM-0001
BOT_TARGET_PLAYERS=8
BOT_MIN_BOTS=4
BOT_MAX_BOTS=12
BOT_GENERATE_GAME_EVENTS=true
BOT_SYNTHETIC_MECHANICS_EVENTS=true
```

The useful proof is not just connected sockets. Look for:

- `player.count` includes non-zero `bots`
- `STWL_GAME_EVENTS` receives bot rows with `source=bot_simulation`
- `/paf/api/context` reports powerups, trail crossings, freezes, and
  coordinates
- `/paf/api/commentary` returns source metadata and persists traces

## Training Export

After a bot-warmed demo or load run, export accepted behavior examples:

```bash
npm --prefix private-agent-factory run export:training -- \
  --dataset-version stwl-commentary-v1 \
  --limit 5000 \
  --output /tmp/stwl-behavior-v1.jsonl
```

Keep raw prompt text redacted for training exports. Use `--include-prompt-text`
only for audited inspection.

Dry-run the dataset shape:

```bash
python3 model-ai/training/train_behavior_lora.py \
  --dataset-uri /tmp/stwl-behavior-v1.jsonl \
  --adapter-uri /tmp/stwl-commentary-adapter \
  --dry-run
```

## Secure A10 Ollama Path

For OCI GPU retraining/inference, keep the Ollama host private to the worker or
model network. The model adapter now supports native Ollama chat:

```bash
STWL_UPSTREAM_FORMAT=ollama
STWL_UPSTREAM_URL=http://<private-a10-ollama-ip>:11434/api/chat
STWL_MODEL_ID=llama3.1:8b-stwl
```

OKE deploy-time wiring:

```bash
MODEL_AI_BASE_UPSTREAM_URL=http://<private-a10-ollama-ip>:11434/api/chat
MODEL_AI_FT_UPSTREAM_URL=http://<private-a10-ollama-ip>:11434/api/chat
MODEL_AI_BASE_UPSTREAM_MODEL_ID=llama3.1:8b
MODEL_AI_FT_UPSTREAM_MODEL_ID=llama3.1:8b-stwl
```

Terraform opt-in variables:

```hcl
model_ai_enabled              = true
model_ai_shape                = "VM.GPU.A10.1"
model_ai_base_upstream_format = "ollama"
model_ai_ft_upstream_format   = "ollama"
model_ai_base_upstream_url    = "http://<private-a10-ollama-ip>:11434/api/chat"
model_ai_ft_upstream_url      = "http://<private-a10-ollama-ip>:11434/api/chat"
```

`model_ollama_enabled = true` creates the private host. Keep it off until the
GPU shape/limit check passes.

Training remains behavior-only:

```bash
STWL_BASE_MODEL_ID=<base-model-id> \
STWL_DATASET_URI=oci://<bucket>@<namespace>/datasets/stwl-behavior-v1.jsonl \
STWL_ADAPTER_URI=oci://<bucket>@<namespace>/adapters/stwl-commentary-lora-v1/ \
python /app/train_behavior_lora.py
```

Then point the private A10 Ollama bootstrap at that adapter prefix:

```hcl
model_ollama_enabled     = true
model_ollama_adapter_uri = "oci://<bucket>@<namespace>/adapters/stwl-commentary-lora-v1/"
```

The bootstrap keeps the host private, downloads the adapter with instance
principal, and creates `llama3.1:8b-stwl` from the base model plus the exported
LoRA adapter.

## Proof Gate

Run the load proof with the strict upstream gate only after the A10/Ollama
endpoint is configured:

```bash
STWL_LOAD_REQUIRE_UPSTREAM_LLM=true \
npm --prefix bots run load:commentary -- \
  --base-url http://130.162.174.167 \
  --tiers 10
```

Stage-safe interpretation:

- `runtime_mode=upstream-llm` proves the adapter reached Ollama.
- `behavior-adapter` means the adapter path is alive but not the live LLM.
- Duplicate commentary, missing score rows, or deterministic fallback should
  fail the proof before you claim model improvement.

## AI Engineer Landing Line

> Bots create the event diversity. Oracle AI Database stores the truth and the
> traces. The harness exports accepted behavior. A10-hosted Ollama learns the
> style. The strict proof gate decides when we are allowed to say the model got
> better.
