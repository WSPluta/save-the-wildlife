# Backend Spring Boot + Gradle Reference

Converted from:

- `backend-gradle-service-rule copy.md`

## Scope

Spring Boot 3.2.x, Java 17, Gradle, OCI SDK, JDBC or UCP, Liquibase, Actuator, Micrometer, and WebSocket or STOMP backend work.

## Core Rules

- Keep Java 17 compatibility intact.
- Use explicit DTOs and validation annotations.
- Sync frontend, docs, and backend contracts together.
- Preserve dependency hygiene and justify additions.
- Secure actuator and observability surfaces.

## DTOs And Controllers

- Use typed DTOs, not raw maps.
- Put validation at the API boundary.
- Namespace or version intentionally if a change breaks compatibility.
- Search for every consumer before changing request or response shape.

## WebSocket And Messaging

- Keep topics and destinations additive when possible.
- Align backend destinations with frontend STOMP subscriptions.
- Document endpoint or topic changes in service docs.

## OCI SDK And GenAI Calls

- Wrap provider-specific calls behind interfaces.
- Use retries, timeouts, or circuit breakers around remote calls.
- Log request metadata, not secrets or prompt payloads that should stay private.

## Database And Liquibase

- Add one change set per schema change.
- Include rollback guidance when feasible.
- Update schema docs when behavior or structure changes.

## Errors And Observability

- Centralize API error handling.
- Expose health endpoints deliberately.
- Keep logs structured and safe for production.

## Validation

- Build and test the backend surface you changed.
- Re-check frontend compatibility.
- Validate migration behavior and runtime config assumptions.
