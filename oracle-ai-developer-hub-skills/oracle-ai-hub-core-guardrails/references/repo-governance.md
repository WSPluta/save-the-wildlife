# Repository Governance Reference

Converted from:

- `cline-for-oci-jet-ui.md`
- `contribution-guardrails.md`
- `secrets-and-credentials-handling.md`
- `dbMCP.md`
- `mermaid-plans.md`

## Purpose

Provide the repo-level guardrails that apply before any specialized frontend, backend, infra, or content workflow starts.

## First-Pass Checklist

1. Search impacted files before editing.
2. Confirm whether the task is frontend, backend, infra, scripts, docs, or mixed.
3. Identify any contract edges:
   - API routes and DTOs
   - env vars and secret keys
   - ports and service names
   - docs and changelog entries
4. Decide the smallest safe patch.

## Minimal-Diff Rules

- Prefer precise edits over large rewrites.
- Do not upgrade dependencies unless requested or required.
- Avoid unrelated formatting churn.
- Use new files only when a targeted edit is insufficient.
- For Kubernetes or Terraform, prefer overlay or additive patterns rather than mutating stable base behavior.

## PR Hygiene

- Keep the change single-purpose.
- Document what changed and why.
- Include validation evidence appropriate to the layer touched.
- Update user-facing docs and `CHANGES.md` for meaningful behavior changes.
- Call out breaking changes, migrations, or operator actions explicitly.

## Dependency And Compliance Rules

- New dependencies need a compatibility and license check.
- Avoid redundant, overlapping, or unpinned dependencies.
- Preserve repository conventions and linting expectations.

## Secret Handling

- No committed secrets, base64 blobs, wallets, or tokens.
- Use placeholders in examples.
- Route secrets through env vars, OCI Vault, Kubernetes Secrets, or sensitive Terraform inputs.
- Review diffs for secret-like strings such as `password`, `api_key`, `PRIVATE KEY`, and wallet contents.
- If a leak is suspected, treat it as an incident: rotate, purge, and document the response path.

## MCP And Planning Notes

- MCP model identifiers should use Oracle Code Assist-prefixed models when the workflow requires that constraint.
- In plan mode, use Mermaid only when the structure is easier to understand visually than in text. Prefer simple, high-contrast diagrams.

## Final Review Questions

1. Did the patch stay scoped and reversible?
2. Were all coupled surfaces checked?
3. Are secrets still externalized?
4. Is validation evidence proportional to the risk?
5. Would a reviewer understand the impact quickly?
