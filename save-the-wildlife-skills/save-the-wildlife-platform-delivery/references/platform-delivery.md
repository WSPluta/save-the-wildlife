# Save The Wildlife Platform Delivery Reference

Grounded in:

- `deploy/k8s/base/**`
- `deploy/k8s/overlays/devops/**`
- `deploy/k8s/overlays/prod/**`
- `deploy/devops/tf-devops/**`
- `deploy/devops/tf-env/**`
- `deploy/vm/terraform/**`
- `deploy/vm/ansible/**`

## Delivery Surfaces

- Kubernetes base manifests for `web`, `ws-server`, `score`, `replay`, and ingress
- Kustomize overlays for `devops` and `prod`
- Terraform for OCI DevOps and environment provisioning
- VM automation via Terraform and Ansible

## Rules

- Prefer overlay and patch-based Kubernetes edits.
- Keep service names, selectors, image tags, ports, and ingress assumptions aligned.
- Treat replica or backend topology changes as operational behavior changes that need validation.
- Keep Terraform changes reviewable and scoped.
- Keep secrets and environment-specific values externalized.

## Validation Paths

- `kustomize build` for the changed overlay
- Terraform validation or plan for the changed module set
- service-level runtime checks after deploy

## Typical Change Patterns

- Scaling change: update the right overlay, not every base.
- New runtime env var: thread it through manifests, scripts, and service expectations together.
- VM or DevOps pipeline change: keep workshop docs and operator instructions consistent.
