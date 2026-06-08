# Generative AI Model Configuration Reference

Converted from:

- `genai-model-config-and-usage.md`

## Scope

Model catalog files, runtime helper code, settings UI, and RAG behavior that depends on model capabilities or context limits.

## Configuration Surfaces

- model documentation
- frontend configuration entries
- runtime request or response helpers
- settings UI selectors and parameter controls
- RAG documentation and token-fit logic

## Safe Change Pattern

When adding a model:

1. Document it.
2. Add the config entry.
3. Update the UI selector and defaults if needed.
4. Teach the runtime helper how to normalize it.
5. Re-check RAG limits and citations behavior.

## Rules

- Never store secrets in model config.
- Do not change defaults without updating docs and UI.
- Prefer enums or unions for model IDs.
- Validate tokens, temperature, and provider-specific settings before submit.
- Keep provider quirks abstracted in one place.

## RAG Guidance

- Fit retrieval size to model context limits.
- Keep citation behavior consistent across models.
- Avoid requests that overrun the model's safe token window.

## Validation

- Confirm UI options render correctly.
- Confirm runtime requests match the selected model.
- Update docs and smoke-test the changed flow.
