---
name: save-the-wildlife-platform-delivery
description: Use when editing Save The Wildlife deployment assets for Kubernetes, Kustomize overlays, OCI DevOps Terraform, VM Terraform or Ansible, environment-specific rollout logic, replicas, services, ingress, or runtime configuration across web, ws-server, score, and replay workloads.
---

# Save The Wildlife Platform Delivery

Use this skill for `deploy/` work.

## Read First

Read `references/platform-delivery.md` before changing Terraform, Kustomize, VM automation, or runtime deployment config.

## Workflow

1. Identify the delivery target first: OKE, OCI DevOps, VM, or local environment helper.
2. Prefer additive overlays, patches, and scoped Terraform changes.
3. Keep runtime wiring aligned across services, ports, secrets, replicas, and health assumptions.
4. Validate manifests or plans before assuming a runtime failure needs code changes.
5. Keep dev and prod overlays intentionally different only where required.

## Pairing

- Pair with `../save-the-wildlife-release-and-dev-scripts/SKILL.md` when deployment behavior is driven by scripts.
- Pair with `../save-the-wildlife-devops-workshop/SKILL.md` when the change also affects the workshop narrative or operator steps.
