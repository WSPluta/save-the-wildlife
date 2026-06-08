---
name: save-the-wildlife-release-and-dev-scripts
description: Use when editing Save The Wildlife automation scripts for local development, semantic version bumps, container builds, release publishing, environment setup, Redis or Coherence startup, deployment helpers, or integrated dev-cycle checks.
---

# Save The Wildlife Release And Dev Scripts

Use this skill for `scripts/` work and for changes that affect the operational developer loop.

## Read First

Read `references/release-and-dev-scripts.md` before changing build, bump, release, startup, stop, or deployment automation.

## Workflow

1. Decide whether the task affects local dev, release, infrastructure helpers, or multiple script flows.
2. Keep script behavior explicit and predictable; do not silently broaden side effects.
3. Prefer extending an existing script to inventing a parallel one unless the workflow is clearly distinct.
4. Preserve service naming conventions such as `web`, `server`, `score`, `replay`, and `ws-server`.
5. Re-run the narrowest useful script path after changes.

## Pairing

- Pair with `../save-the-wildlife-web-gameplay/SKILL.md` or `../save-the-wildlife-realtime-server/SKILL.md` when the script change is just supporting code changes.
- Pair with `../save-the-wildlife-platform-delivery/SKILL.md` for release or deploy automation changes.
