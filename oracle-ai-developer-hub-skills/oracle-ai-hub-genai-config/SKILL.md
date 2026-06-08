---
name: oracle-ai-hub-genai-config
description: Use when adding, removing, or changing Generative AI model configuration, model settings UI, runtime request helpers, or RAG integration behavior in the OCI Generative AI JET UI repository.
---

# Oracle AI Hub GenAI Config

Use this skill for model catalog work, request parameter changes, runtime helper updates, and RAG-aware model behavior.

## Read First

Read `references/genai-models.md` before touching model IDs, settings UI, runtime normalization, or RAG token-fitting logic.

## Workflow

1. Inventory every configuration surface first: docs, UI, runtime helpers, and RAG behavior.
2. Prefer additive model introduction over silently replacing defaults.
3. Keep model IDs stable, labels readable, and parameter bounds explicit.
4. Centralize model types and provider quirks in shared helpers.
5. Pair with the frontend skill for settings UI work.
6. Confirm documentation, smoke coverage, and compatibility before finalizing.
