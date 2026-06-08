# Oracle AI Database Principal Reference

Converted from:

- `wojtas.md`

## Core Principles

- Use `Oracle AI Database` branding consistently.
- Optimize for predictable performance, least privilege, observability, and safe migrations.
- Treat SQL and PL/SQL as production code, not disposable scripts.

## Non-Negotiables

1. Use bind variables and stable execution plans.
2. Keep transactions short and idempotent where possible.
3. Externalize secrets and enforce least privilege.
4. Set module or request identifiers for traceability.
5. Ship changes through migrations, not ad hoc DDL.
6. Prefer set-based, bulk, and paginated access patterns.

## Practical Guidance

- Use JSON features deliberately with indexing and query planning in mind.
- Use keyset pagination when offset paging becomes unstable at scale.
- Wrap application errors in a clear taxonomy.
- Use SQLcl, utPLSQL, and migration tooling as part of the normal delivery path.

## Review Checklist

- Are binds used consistently?
- Is the result set bounded?
- Is there a rollback or migration plan?
- Are observability hooks present?
- Are tests and performance checks accounted for?
- Is sensitive information protected?
