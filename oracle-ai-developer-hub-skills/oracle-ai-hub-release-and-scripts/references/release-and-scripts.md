# Release And Scripts Reference

Converted from:

- `repo-scripts-usage.md`
- `release-versioning-and-changelog.md`

## Script Rules

- Target Node 18+ and ESM for Node automation.
- Use shared helpers for path, environment, container, Terraform, or release logic.
- Add flags instead of breaking defaults.
- Keep writes confined and predictable.
- Avoid platform-specific shell behavior when JavaScript can do the job more safely.

## Script Safety

- No secrets in logs.
- Support `--help` and, where useful, `--dry-run`.
- Exit non-zero on failure.
- Keep path resolution robust and repo-relative.

## Release Rules

- Use semantic versioning.
- Keep all version sources aligned in one PR.
- Update changelog entries with clear sections and a real date.
- Refresh artifact inventory so it matches the produced release payloads.
- Avoid unrelated refactors in release-only PRs.

## Common Release Sequence

1. Confirm merged scope.
2. Bump versions.
3. Update changelog.
4. Refresh artifact inventory.
5. Run the relevant validation steps.
6. Tag or publish through the intended pipeline.

## Validation

- Test the affected script path.
- Verify output files and version alignment.
- Check docs or usage text if behavior changed.
