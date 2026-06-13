import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_SYSTEM_PROMPT = (
    "You are the Save the Wildlife commentary model. Facts and changing game "
    "state stay in Oracle AI Database memory. Learn the behavior only: concise "
    "commentary, evidence-aware wording, calibrated confidence, and safe stage tone."
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train a behavior-only LoRA/QLoRA adapter for Save the Wildlife commentary."
    )
    parser.add_argument("--dataset-uri", default=os.environ.get("STWL_DATASET_URI", ""))
    parser.add_argument("--adapter-uri", default=os.environ.get("STWL_ADAPTER_URI", ""))
    parser.add_argument("--base-model", default=os.environ.get("STWL_BASE_MODEL_ID", ""))
    parser.add_argument("--output-dir", default=os.environ.get("STWL_OUTPUT_DIR", "/tmp/stwl-commentary-adapter"))
    parser.add_argument("--rubric-version", default=os.environ.get("STWL_RUBRIC_VERSION", "stwl-commentary-v1"))
    parser.add_argument("--dataset-version", default=os.environ.get("STWL_DATASET_VERSION", "weekend-demo"))
    parser.add_argument("--max-seq-length", type=int, default=int(os.environ.get("STWL_MAX_SEQ_LENGTH", "2048")))
    parser.add_argument("--epochs", type=float, default=float(os.environ.get("STWL_EPOCHS", "1")))
    parser.add_argument("--learning-rate", type=float, default=float(os.environ.get("STWL_LEARNING_RATE", "0.0002")))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("STWL_BATCH_SIZE", "1")))
    parser.add_argument(
        "--gradient-accumulation-steps",
        type=int,
        default=int(os.environ.get("STWL_GRADIENT_ACCUMULATION_STEPS", "8")),
    )
    parser.add_argument("--lora-r", type=int, default=int(os.environ.get("STWL_LORA_R", "16")))
    parser.add_argument("--lora-alpha", type=int, default=int(os.environ.get("STWL_LORA_ALPHA", "32")))
    parser.add_argument("--lora-dropout", type=float, default=float(os.environ.get("STWL_LORA_DROPOUT", "0.05")))
    parser.add_argument(
        "--precision",
        choices=["fp16", "bf16", "fp32"],
        default=os.environ.get("STWL_TRAINING_PRECISION", "fp16"),
    )
    parser.add_argument(
        "--target-modules",
        default=os.environ.get("STWL_LORA_TARGET_MODULES", "q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj"),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.environ.get("STWL_TRAINING_DRY_RUN", "false").lower() == "true",
        help="Validate and summarize the dataset without importing GPU training dependencies.",
    )
    parser.add_argument(
        "--allow-raw-evidence",
        action="store_true",
        default=os.environ.get("STWL_ALLOW_RAW_EVIDENCE", "false").lower() == "true",
        help="Allow raw evidence_json in training examples. Default keeps facts as refs/hashes only.",
    )
    parser.add_argument(
        "--use-4bit",
        action="store_true",
        default=os.environ.get("STWL_USE_4BIT", "true").lower() not in {"0", "false", "no", "off"},
    )
    return parser.parse_args()


def parse_oci_uri(uri):
    parsed = urlparse(uri)
    if parsed.scheme != "oci":
        return None
    bucket = parsed.netloc
    namespace = ""
    if "@" in bucket:
        bucket, namespace = bucket.split("@", 1)
    object_name = parsed.path.lstrip("/")
    if not bucket or not object_name:
        raise ValueError(f"invalid OCI URI: {uri}")
    return bucket, namespace, object_name


def read_text_uri(uri):
    if uri == "-":
        return sys.stdin.read()
    parsed_oci = parse_oci_uri(uri)
    if parsed_oci:
        bucket, namespace, object_name = parsed_oci
        try:
            import oci
        except ImportError as exc:
            raise SystemExit("Install the oci Python SDK to read oci:// dataset URIs.") from exc
        signer = oci.auth.signers.get_resource_principals_signer()
        client = oci.object_storage.ObjectStorageClient(config={}, signer=signer)
        if not namespace:
            namespace = client.get_namespace().data
        response = client.get_object(namespace, bucket, object_name)
        return response.data.content.decode("utf-8")
    parsed = urlparse(uri)
    path = Path(parsed.path if parsed.scheme == "file" else uri)
    return path.read_text(encoding="utf-8")


def write_file(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")


def upload_directory_to_oci(local_dir, adapter_uri):
    parsed_oci = parse_oci_uri(adapter_uri)
    if not parsed_oci:
        return None
    bucket, namespace, prefix = parsed_oci
    try:
        import oci
    except ImportError as exc:
        raise SystemExit("Install the oci Python SDK to upload adapters to oci:// URIs.") from exc
    signer = oci.auth.signers.get_resource_principals_signer()
    client = oci.object_storage.ObjectStorageClient(config={}, signer=signer)
    if not namespace:
        namespace = client.get_namespace().data
    uploaded = []
    base = Path(local_dir)
    for path in base.rglob("*"):
        if not path.is_file():
            continue
        object_name = f"{prefix.rstrip('/')}/{path.relative_to(base).as_posix()}"
        client.put_object(namespace, bucket, object_name, path.read_bytes())
        uploaded.append(f"oci://{bucket}@{namespace}/{object_name}")
    return uploaded


def parse_records(text):
    text = text.strip()
    if not text:
        return []
    if text.startswith("["):
        payload = json.loads(text)
        if not isinstance(payload, list):
            raise ValueError("JSON dataset must be a list of records")
        return payload
    records = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        clean = line.strip()
        if not clean:
            continue
        try:
            records.append(json.loads(clean))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSONL at line {line_no}: {exc}") from exc
    return records


def json_maybe(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def first_text(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
        if not isinstance(value, (dict, list)):
            text = str(value).strip()
            if text:
                return text
    return ""


def evidence_refs(record, example_json):
    refs = {
        "trace_id": record.get("trace_id"),
        "prompt_hash": record.get("prompt_hash") or example_json.get("prompt_hash"),
        "evidence_hash": record.get("evidence_hash") or example_json.get("evidence_hash"),
        "citations": record.get("citations") or example_json.get("citations") or [],
        "rubric_version": record.get("rubric_version"),
    }
    return {key: value for key, value in refs.items() if value not in (None, "", [])}


def normalize_record(record, allow_raw_evidence=False):
    if not isinstance(record, dict):
        raise ValueError("training record must be a JSON object")
    example_json = json_maybe(record.get("example_json") or {})
    if not isinstance(example_json, dict):
        example_json = {}

    if record.get("messages"):
        messages = record["messages"]
        if not isinstance(messages, list) or len(messages) < 2:
            raise ValueError("messages must be a chat-style list with at least user and assistant turns")
        assistant = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "assistant"), "")
        if not assistant:
            raise ValueError("messages record is missing assistant content")
        return {
            "messages": messages,
            "metadata": evidence_refs(record, example_json),
        }

    output = first_text(
        record.get("output_text"),
        record.get("commentary"),
        record.get("assistant"),
        record.get("text"),
        example_json.get("text"),
    )
    if not output:
        raise ValueError(f"record {record.get('trace_id') or '<unknown>'} is missing output commentary")

    prompt = first_text(record.get("prompt_text"), record.get("prompt"), record.get("input"))
    if not prompt:
        prompt = (
            "Produce one concise Save the Wildlife commentary line using only the supplied "
            "Oracle AI Database evidence references."
        )

    refs = evidence_refs(record, example_json)
    if record.get("evidence_json") and allow_raw_evidence:
        refs["evidence_json"] = json_maybe(record["evidence_json"])
    elif record.get("evidence_json"):
        refs["evidence_json_omitted"] = "facts remain in Oracle AI Database memory"

    user = prompt
    if refs:
        user = f"{prompt}\n\nEvidence references:\n{json.dumps(refs, sort_keys=True)}"

    return {
        "messages": [
            {"role": "system", "content": first_text(record.get("system"), DEFAULT_SYSTEM_PROMPT)},
            {"role": "user", "content": user},
            {"role": "assistant", "content": output},
        ],
        "metadata": refs,
    }


def build_examples(records, allow_raw_evidence=False):
    examples = []
    errors = []
    for index, record in enumerate(records):
        try:
            normalized = normalize_record(record, allow_raw_evidence=allow_raw_evidence)
            examples.append(normalized)
        except Exception as exc:
            errors.append({"index": index, "error": str(exc)})
    return examples, errors


def format_messages(tokenizer, messages):
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return "\n".join(f"{message['role'].upper()}: {message['content']}" for message in messages)


def write_training_jsonl(path, examples):
    lines = [json.dumps({"messages": item["messages"], "metadata": item["metadata"]}, sort_keys=True) for item in examples]
    write_file(path, "\n".join(lines) + ("\n" if lines else ""))


def base_manifest(args, examples, errors):
    return {
        "ok": not errors,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset_uri": args.dataset_uri,
        "adapter_uri": args.adapter_uri,
        "base_model": args.base_model,
        "dataset_version": args.dataset_version,
        "rubric_version": args.rubric_version,
        "training_policy": "behavior-only",
        "facts_policy": "facts and evidence stay in Oracle AI Database memory; training examples carry prompts, citations, and hashes",
        "example_count": len(examples),
        "rejected_count": len(errors),
        "errors": errors[:20],
    }


def run_dry_run(args, examples, errors):
    manifest = base_manifest(args, examples, errors)
    manifest["dry_run"] = True
    manifest["sample"] = examples[0] if examples else None
    print(json.dumps(manifest, indent=2, sort_keys=True), flush=True)
    return 0 if not errors and examples else 1


def train_adapter(args, examples):
    if not args.base_model:
        raise SystemExit("missing --base-model or STWL_BASE_MODEL_ID for non-dry-run training")
    try:
        from datasets import Dataset
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TrainingArguments
        from trl import SFTTrainer
        import torch
    except ImportError as exc:
        raise SystemExit(
            "Missing GPU training dependencies. Build the GPU BYOC image from "
            "model-ai/training/Dockerfile.gpu or install transformers, datasets, peft, "
            "accelerate, bitsandbytes, torch, and trl."
        ) from exc

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    train_rows = [{"text": format_messages(tokenizer, item["messages"])} for item in examples]
    dataset = Dataset.from_list(train_rows)

    quantization_config = None
    if args.use_4bit:
        compute_dtype = {
            "bf16": torch.bfloat16,
            "fp16": torch.float16,
            "fp32": torch.float32,
        }[args.precision]
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=compute_dtype,
        )

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        device_map="auto",
        quantization_config=quantization_config,
        trust_remote_code=True,
    )
    if args.use_4bit:
        model = prepare_model_for_kbit_training(model)

    target_modules = [item.strip() for item in args.target_modules.split(",") if item.strip()]
    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=target_modules,
    )
    model = get_peft_model(model, peft_config)

    output_dir = Path(args.output_dir)
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(output_dir),
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        bf16=args.precision == "bf16",
        fp16=args.precision == "fp16",
        logging_steps=5,
        save_strategy="epoch",
        report_to=[],
    )
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=training_args,
        peft_config=peft_config,
        tokenizer=tokenizer,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
    )
    trainer.train()
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))

    manifest = base_manifest(args, examples, [])
    manifest.update({
        "dry_run": False,
        "output_dir": str(output_dir),
        "target_modules": target_modules,
        "lora": {
            "r": args.lora_r,
            "alpha": args.lora_alpha,
            "dropout": args.lora_dropout,
        },
    })
    write_file(output_dir / "stwl_training_manifest.json", json.dumps(manifest, indent=2, sort_keys=True))

    uploaded = upload_directory_to_oci(output_dir, args.adapter_uri) if args.adapter_uri.startswith("oci://") else None
    if uploaded:
        manifest["uploaded"] = uploaded
        write_file(output_dir / "stwl_training_manifest.json", json.dumps(manifest, indent=2, sort_keys=True))
    print(json.dumps(manifest, indent=2, sort_keys=True), flush=True)
    return 0


def main():
    args = parse_args()
    if not args.dataset_uri:
        raise SystemExit("missing --dataset-uri or STWL_DATASET_URI")
    if not args.adapter_uri:
        raise SystemExit("missing --adapter-uri or STWL_ADAPTER_URI")

    text = read_text_uri(args.dataset_uri)
    records = parse_records(text)
    examples, errors = build_examples(records, allow_raw_evidence=args.allow_raw_evidence)

    preview_dir = Path(tempfile.gettempdir()) / "stwl-model-ai-training-preview"
    write_training_jsonl(preview_dir / "behavior_examples.chat.jsonl", examples)

    if args.dry_run:
        return run_dry_run(args, examples, errors)
    if errors:
        print(json.dumps(base_manifest(args, examples, errors), indent=2, sort_keys=True), file=sys.stderr)
        raise SystemExit("dataset contains rejected records")
    if not examples:
        raise SystemExit("dataset contains no trainable examples")
    return train_adapter(args, examples)


if __name__ == "__main__":
    raise SystemExit(main())
