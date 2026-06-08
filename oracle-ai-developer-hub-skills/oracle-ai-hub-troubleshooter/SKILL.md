---
name: oracle-ai-hub-troubleshooter
description: Use when diagnosing failures in local development, WebSocket flows, backend APIs, Kubernetes deployments, Terraform runs, or model and RAG behavior in the OCI Generative AI JET UI repository.
---

# Oracle AI Hub Troubleshooter

Use this skill when the task is diagnosis first and implementation second.

## Read First

Read `references/troubleshooting.md` before changing code in response to a failure that has not been isolated yet.

## Workflow

1. Write down expected versus actual behavior.
2. Scope the failure to a layer before editing anything.
3. Gather evidence from the narrowest useful set of logs, commands, or UI signals.
4. Test one hypothesis at a time.
5. Only implement a fix after the failing layer is reasonably isolated.

## Pairing

- Frontend symptom: pair with `../oracle-ai-hub-frontend-jet/SKILL.md`
- Backend symptom: pair with `../oracle-ai-hub-backend-gradle/SKILL.md`
- Infra symptom: pair with `../oracle-ai-hub-platform-delivery/SKILL.md`
