---
name: oracle-ai-hub-rebrand
description: Use when updating documentation, UI copy, comments, or repository text to use the correct Oracle AI Database branding and to run a minimal-diff rebrand sweep without changing code behavior.
---

# Oracle AI Hub Rebrand

Use this skill for terminology sweeps and targeted text corrections.

## Read First

Read `references/rebrand.md` before editing product naming across docs, UI copy, comments, or deployment text.

## Workflow

1. Inventory legacy terms first.
2. Distinguish product branding from accurate references to Oracle Autonomous Database.
3. Keep the patch text-only unless the user explicitly asks for deeper refactoring.
4. Re-scan after changes to catch leftovers and false positives.
5. Update changelog only if the wording change is user-visible or release-relevant.
