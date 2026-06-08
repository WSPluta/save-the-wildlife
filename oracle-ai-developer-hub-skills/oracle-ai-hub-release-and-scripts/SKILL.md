---
name: oracle-ai-hub-release-and-scripts
description: Use when changing repository automation scripts, release workflows, semantic versioning, changelog entries, artifact inventories, or script behavior for kustomize, tfvars, or release orchestration.
---

# Oracle AI Hub Release And Scripts

Use this skill for `scripts/` work and for release-preparation tasks that need synchronized versions and artifact metadata.

## Read First

Read `references/release-and-scripts.md` before changing script entry points, version sources, or release outputs.

## Workflow

1. Decide whether the task is script behavior, release metadata, or both.
2. Keep script changes localized and favor shared helpers over duplicated inline logic.
3. Add `--help`, `--dry-run`, or explicit failure paths for user-facing automation.
4. For releases, keep version numbers, changelog, and artifact inventory synchronized in one change.
5. Sanitize logs and outputs.
6. Validate the exact script or release path you touched.
