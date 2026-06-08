# Platform Delivery Reference

Converted from:

- `oci-oke-adb-automation.md`
- `kubernetes-deployments-and-kustomize.md`
- `terraform-oke-adb-infra.md`

## Delivery Layers

- Terraform for OCI infrastructure
- Kustomize and Kubernetes overlays for workloads
- Automation entry points for env setup, tfvars, kubeconfig, wallet handling, release, health checks, and rollback

## End-To-End Flow

1. Validate env, profile, and region.
2. Render tfvars from templates.
3. Init and plan Terraform.
4. Apply only after review or approval.
5. Generate kubeconfig for the target OKE cluster.
6. Apply Kustomize overlays.
7. Retrieve ADB wallet and create or refresh the Kubernetes Secret.
8. Release images or workloads.
9. Run health checks.

## Terraform Rules

- Prefer additive changes and inspect plans for unintended destroys.
- Pin providers and modules.
- Keep tfvars generated, not hand-maintained.
- Mark sensitive outputs appropriately.
- Document new inputs and outputs.

## Kubernetes Rules

- Prefer overlays and patches over base edits.
- Keep labels, selectors, image tags, and ports aligned.
- Use readiness and liveness probes where they matter for rollout safety.
- Keep secrets out of manifests.
- Avoid renaming stable objects without a migration plan.

## Automation Contract

Automation should expose stable commands for:

- env setup
- tfvars rendering
- Terraform init, plan, apply, and outputs
- kubeconfig generation
- Kustomize diff and apply
- ADB wallet retrieval
- Kubernetes secret creation
- release
- health checks
- rollback

Keep Node and Python entry points behaviorally aligned if both are maintained.

## Validation

- `terraform fmt`, `validate`, and plan review for infra
- `kustomize build` for manifest integrity
- health checks and rollout evidence after deployment
- redacted artifacts for review
