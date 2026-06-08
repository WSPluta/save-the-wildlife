# Save The Wildlife Release And Dev Scripts Reference

Grounded in:

- `scripts/build.mjs`
- `scripts/bump.mjs`
- `scripts/release.mjs`
- `scripts/deploy.mjs`
- `scripts/setenv.mjs`
- `scripts/tfvars.mjs`
- `scripts/dev_start.sh`
- `scripts/dev_start_minimal.sh`
- `scripts/dev_stop.sh`
- `scripts/start_redis.mjs`
- `scripts/start_coherence.mjs`
- `scripts/start_local_db.mjs`
- `scripts/dev_cycle_check.mjs`

## Scope

Use for automation around local startup, quality checks, versioning, image builds, releases, and deployment helpers.

## Rules

- Keep service selectors consistent with current script usage.
- Respect existing dev loop helpers instead of duplicating them.
- When changing build or release behavior, verify that image naming and service version resolution still line up.
- Keep script output actionable and avoid leaking secrets or env-sensitive values.
- Integrated checks should remain deterministic enough for local use.

## Validation Paths

- run the exact modified script path
- `node scripts/dev_cycle_check.mjs` when a broader local quality sweep is warranted
- service-specific tests if the script orchestrates app behavior rather than pure automation

## Important Existing Flows

- version bumping by service
- container image build by service
- release publishing by service
- environment setup
- Redis and Coherence startup and shutdown
- local DB startup
- integrated browser-backed dev cycle check
