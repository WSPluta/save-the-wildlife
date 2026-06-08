---
name: save-the-wildlife-core-guardrails
description: Use when making cross-service or repo-wide changes in Save The Wildlife and you need guardrails for project structure, semantic version bumps, secrets handling, distributed backend toggles, local validation, and coordinated edits across web, server, score, replay, scripts, and deploy assets.
---

# Save The Wildlife Core Guardrails

Use this skill before any task that spans more than one service or could affect releases, deployments, or workshop steps.

## Read First

Read `references/core-guardrails.md` at the start of multi-surface work.

## Workflow

1. Identify the touched surfaces first: `web`, `server`, `score`, `replay`, `scripts`, `deploy`, or `livelabs`.
2. Keep the change small and preserve the existing service boundaries.
3. Before user-visible or release-relevant changes, check whether `scripts/bump.mjs` and version files need to stay aligned.
4. Keep Redis and Coherence toggles explicit and avoid hidden behavior changes behind environment defaults.
5. Validate the narrowest useful set of checks locally before broad rollout.

## Hard Rules

- No committed secrets, wallets, or real cloud credentials.
- Avoid touching `build_spec.yaml` or `command_spec.yaml` unless the task genuinely requires it.
- Cross-service features must update the browser, server events, and service endpoints together.
- Prefer repo scripts over ad hoc shell sequences when a script already exists for the task.
