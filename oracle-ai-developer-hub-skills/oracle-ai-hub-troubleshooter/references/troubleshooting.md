# Troubleshooting And Diagnostics Reference

Converted from:

- `troubleshooting-and-diagnostics.md`

## Triage Sequence

1. Define the failure clearly.
2. Decide whether it is local, deployed, isolated, or systemic.
3. Pick the most likely layer:
   - UI
   - network
   - backend
   - WebSocket
   - Kubernetes
   - Terraform
   - model or RAG behavior
4. Gather the signals for that layer.
5. Test a minimal hypothesis.

## Local Development

- Check frontend build, serve output, browser console, and network behavior.
- Check backend build, boot logs, and health endpoints.
- Verify URLs, proxies, CORS, and port assumptions.

## WebSocket Or STOMP

- Check upgrade requests, connect and subscribe flow, destination paths, reconnect logic, and cleanup.

## Kubernetes

- Inspect namespaces, pods, services, ingress, logs, and selectors.
- Validate Kustomize output before assuming runtime drift.

## Terraform And OCI

- Start with formatting, validation, and plan output.
- Compare planned change to intended change before applying anything.

## Model And RAG

- Check model IDs, parameter bounds, response handling, token fit, retrieval size, and citation paths.

## Anti-Pattern

- Do not shotgun-edit multiple layers before you have a credible failing layer.
