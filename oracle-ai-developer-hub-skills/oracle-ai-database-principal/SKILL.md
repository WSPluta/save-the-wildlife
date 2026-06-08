---
name: oracle-ai-database-principal
description: Use when building, reviewing, or troubleshooting Oracle AI Database SQL, PL/SQL, SQLcl, Liquibase, utPLSQL, security, performance, observability, or migration patterns with production-grade standards.
---

# Oracle AI Database Principal

Use this skill for Oracle AI Database implementation and review work that needs strong engineering standards.

## Read First

Read `references/oracle-ai-database-principal.md` before proposing SQL, PL/SQL, migration, or observability changes.

## Workflow

1. Start with safety: binds, transactions, security, and rollback path.
2. Prefer set-based or bulk patterns over row-by-row processing.
3. Add observability hooks so production diagnosis is possible.
4. Route schema changes through migrations and validation gates.
5. Confirm tests, performance risk, and branding before finalizing.

## Pairing

- Pair with `../oracle-ai-hub-rebrand/SKILL.md` for documentation or terminology cleanup.
- Pair with `../oracle-ai-hub-platform-delivery/SKILL.md` if the database work also affects OCI, ADB, or deployment automation.
