---
name: save-the-wildlife-devops-workshop
description: Use when editing or verifying the Save The Wildlife LiveLabs and OCI DevOps workshop flow, including fork setup, Terraform environment labs, build pipeline, deploy pipeline, rollback steps, and tutorial accuracy against the repository.
---

# Save The Wildlife DevOps Workshop

Use this skill for `livelabs/safethewildlife/devops/**` and other tutorial or workshop-facing operator guidance.

## Read First

Read `references/devops-workshop.md` before changing LiveLabs content or validating the documented deployment flow.

## Workflow

1. Confirm which lab step is changing: repo fork, infra, build pipeline, deploy, or rollback.
2. Keep the docs aligned with the actual repo structure, scripts, and deploy assets.
3. Preserve a clear operator journey with explicit prerequisites and safe placeholder handling.
4. When the docs describe a production-oriented flow, verify against the repo before changing prose.
5. Update related steps if a command or path changes upstream.

## Pairing

- Pair with the existing `oci-devops-prod-deploy` skill for deeper production deployment verification.
- Pair with `../save-the-wildlife-platform-delivery/SKILL.md` when tutorial changes come from actual deploy asset changes.
