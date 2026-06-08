---
name: oracle-ai-hub-router
description: Use when working in the OCI Generative AI JET UI or Oracle AI Developer Hub repository and you need to choose the right skill for frontend, backend, GenAI config, platform delivery, release engineering, DevRel content, branding, troubleshooting, or Oracle AI Database work.
---

# Oracle AI Hub Router

This is the entry skill for the rule set converted from the repository's `.clinerules`.

## Use This Skill To Route

Read only the skill that matches the task:

- Frontend Oracle JET or React/TypeScript work: `../oracle-ai-hub-frontend-jet/SKILL.md`
- Spring Boot, Gradle, DTO, WebSocket, Liquibase, or backend OCI SDK work: `../oracle-ai-hub-backend-gradle/SKILL.md`
- Model catalog, model parameters, runtime helpers, or RAG integration changes: `../oracle-ai-hub-genai-config/SKILL.md`
- Kubernetes, Kustomize, Terraform, OCI automation, or OKE/ADB rollout work: `../oracle-ai-hub-platform-delivery/SKILL.md`
- Release flow, version bumps, changelog updates, or repository scripts: `../oracle-ai-hub-release-and-scripts/SKILL.md`
- DevRel article drafting or article refreshes from repository context: `../oracle-ai-hub-devrel-author/SKILL.md`
- Repository-wide branding sweeps to "Oracle AI Database": `../oracle-ai-hub-rebrand/SKILL.md`
- Triage, reproduction, diagnostics, and layered debugging: `../oracle-ai-hub-troubleshooter/SKILL.md`
- SQL, PL/SQL, SQLcl, Liquibase, utPLSQL, observability, or Oracle AI Database implementation work: `../oracle-ai-database-principal/SKILL.md`
- Cross-cutting guardrails, PR hygiene, secrets handling, or multi-surface edits: `../oracle-ai-hub-core-guardrails/SKILL.md`

## Operating Rules

- Prefer the smallest relevant skill set. Do not load every skill by default.
- For multi-surface tasks, start with `oracle-ai-hub-core-guardrails`, then add the tech-specific skill.
- For branding-only work, use `oracle-ai-hub-rebrand` instead of doing an unfocused repo sweep.
- For DevRel content, pair `oracle-ai-hub-devrel-author` with `oracle-ai-hub-rebrand` when terminology drift is likely.
- For production-impacting infra changes, pair `oracle-ai-hub-platform-delivery` with `oracle-ai-hub-release-and-scripts` if versioned artifacts are involved.

## Source Coverage

This router covers the converted guidance from:

- `cline-for-oci-jet-ui.md`
- `contribution-guardrails.md`
- `secrets-and-credentials-handling.md`
- `frontend-jet-react-conventions.md`
- `backend-gradle-service-rule copy.md`
- `genai-model-config-and-usage.md`
- `kubernetes-deployments-and-kustomize.md`
- `terraform-oke-adb-infra.md`
- `oci-oke-adb-automation.md`
- `repo-scripts-usage.md`
- `release-versioning-and-changelog.md`
- `devrel-content-authoring.md`
- `contextPrompt.md`
- `workflows/devrel-content.md`
- `branding-oracle-ai-database.md`
- `workflows/rebrand.md`
- `troubleshooting-and-diagnostics.md`
- `dbMCP.md`
- `mermaid-plans.md`
- `wojtas.md`
