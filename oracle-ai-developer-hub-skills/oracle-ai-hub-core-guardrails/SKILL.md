---
name: oracle-ai-hub-core-guardrails
description: Use when making repository-wide or multi-surface changes in the OCI Generative AI JET UI or Oracle AI Developer Hub codebase and you need cross-cutting guardrails for minimal diffs, secrets handling, PR hygiene, MCP model selection, and safe edit planning.
---

# Oracle AI Hub Core Guardrails

Use this skill before any task that spans multiple surfaces or could create policy, security, or review risk.

## When To Read References

- Read `references/repo-governance.md` at the start of repo-wide or cross-component work.
- Re-read the PR checklist section before finalizing.
- If the task touches terminology at scale, switch to `../oracle-ai-hub-rebrand/SKILL.md`.

## Core Workflow

1. Map impact first. Search for APIs, env vars, ports, file owners, and docs before editing.
2. Keep diffs narrow. Prefer additive or targeted changes over rewrites.
3. Treat secrets as non-negotiable. Use env vars, OCI Vault, or Kubernetes Secrets only.
4. Sync cross-surface contracts. If APIs, ports, config keys, or user-facing behavior change, update every coupled surface.
5. Use concise validation evidence. Builds, tests, screenshots, logs, or plans should match the changed surface.
6. Finalize with PR hygiene. Scope, changelog, dependency review, and compliance checks should all be explicit.

## Hard Rules

- Never commit credentials, wallets, private keys, or real endpoints with secrets attached.
- Do not change defaults, ports, dependencies, or config structure casually.
- Keep changes reversible and easy to review.
- In plan mode, include a Mermaid diagram only when it makes the plan materially clearer.
- For MCP model configuration, prefer Oracle Code Assist-prefixed models.

## Skill Pairing

- Frontend work: pair with `../oracle-ai-hub-frontend-jet/SKILL.md`
- Backend work: pair with `../oracle-ai-hub-backend-gradle/SKILL.md`
- Infra work: pair with `../oracle-ai-hub-platform-delivery/SKILL.md`
- Release work: pair with `../oracle-ai-hub-release-and-scripts/SKILL.md`
