---
name: oracle-ai-hub-platform-delivery
description: Use when editing Kubernetes, Kustomize, Terraform, OCI deployment automation, OKE configuration, Autonomous Database deployment flows, kubeconfig generation, wallet handling, or production rollout and rollback logic.
---

# Oracle AI Hub Platform Delivery

Use this skill for infrastructure and deployment work across Terraform, Kubernetes, OCI automation, OKE, and ADB integrations.

## Read First

Read `references/platform-delivery.md` before changing overlays, Terraform modules, rollout steps, or automation contracts.

## Workflow

1. Decide which layer is changing: Terraform, Kustomize, release automation, or the end-to-end delivery flow.
2. Keep infrastructure changes additive and reviewable.
3. Separate non-sensitive config from secrets, wallets, and credentials.
4. Use generated artifacts and plans as evidence, especially for higher-risk changes.
5. Require approval gates for production-impacting apply steps.
6. Validate the changed layer, then confirm cross-layer consistency.

## Pairing

- Pair with `../oracle-ai-hub-release-and-scripts/SKILL.md` when scripts or release artifacts are part of the rollout.
- Pair with `../oracle-ai-hub-troubleshooter/SKILL.md` when you are debugging broken deploys rather than implementing a known change.
