---
name: oracle-ai-hub-backend-gradle
description: Use when editing the Spring Boot and Gradle backend for the OCI Generative AI JET UI repository, including DTOs, controllers, WebSocket endpoints, OCI SDK integrations, Liquibase changes, validation, and observability.
---

# Oracle AI Hub Backend Gradle

Use this skill for `backend/` changes and for any task where frontend contracts depend on backend behavior.

## Read First

Read `references/backend-gradle-service.md` before changing APIs, DTOs, Liquibase, or integration code.

## Workflow

1. Search the frontend and docs before changing DTOs, routes, or topics.
2. Keep the change additive where possible. Prefer new endpoints, optional fields, or deprecations over silent breaks.
3. Externalize all sensitive values and sanitize logs.
4. Wrap OCI SDK usage behind interfaces and resilience boundaries.
5. Use additive Liquibase change sets only. Never rewrite applied change sets.
6. Validate build, tests, and operational endpoints for the affected path.

## Pairing

- Pair with `../oracle-ai-hub-frontend-jet/SKILL.md` for contract changes.
- Pair with `../oracle-ai-hub-platform-delivery/SKILL.md` for probe, port, or deployment implications.
