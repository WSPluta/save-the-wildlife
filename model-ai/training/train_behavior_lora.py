import argparse
import json
import os
import sys
from datetime import datetime, timezone


def parse_args():
    parser = argparse.ArgumentParser(
        description="Prepare a behavior-only Save the Wildlife LoRA training run."
    )
    parser.add_argument("--dataset-uri", default=os.environ.get("STWL_DATASET_URI", ""))
    parser.add_argument("--adapter-uri", default=os.environ.get("STWL_ADAPTER_URI", ""))
    parser.add_argument("--rubric-version", default=os.environ.get("STWL_RUBRIC_VERSION", "stwl-commentary-v1"))
    parser.add_argument("--dry-run", action="store_true", default=os.environ.get("STWL_TRAINING_DRY_RUN", "false").lower() == "true")
    return parser.parse_args()


def main():
    args = parse_args()
    if not args.dataset_uri:
        raise SystemExit("missing --dataset-uri or STWL_DATASET_URI")
    if not args.adapter_uri:
        raise SystemExit("missing --adapter-uri or STWL_ADAPTER_URI")

    manifest = {
        "ok": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset_uri": args.dataset_uri,
        "adapter_uri": args.adapter_uri,
        "rubric_version": args.rubric_version,
        "training_policy": "behavior-only",
        "facts_policy": "facts and evidence stay in Oracle AI Database memory",
        "expected_columns": [
            "trace_id",
            "prompt_hash",
            "evidence_hash",
            "provider",
            "model_id",
            "output_text",
            "eval_scores",
            "citations",
        ],
    }
    print(json.dumps(manifest, indent=2), flush=True)

    try:
        import accelerate  # noqa: F401
        import datasets  # noqa: F401
        import peft  # noqa: F401
        import transformers  # noqa: F401
    except ImportError as exc:
        if args.dry_run:
            return 0
        print(
            "LoRA runtime dependencies are not installed in this lightweight image. "
            "Build a GPU BYOC image with transformers, datasets, peft, accelerate, and torch.",
            file=sys.stderr,
        )
        raise SystemExit(str(exc))

    print(
        "Training dependencies detected. Launch the repository-specific trainer here "
        "after mounting the behavior-only dataset from Object Storage.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
