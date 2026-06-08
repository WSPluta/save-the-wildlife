# Save The Wildlife Spring Services Reference

Grounded in:

- `score/build.gradle`
- `replay/build.gradle`
- `score/src/main/resources/application.properties`
- `score/src/main/resources/application-local.properties`

## Current Stack

- Spring Boot 2.7.9
- Java 11
- Spring Web
- Spring Data JPA in `score`
- Actuator
- Micrometer Prometheus registry
- Oracle JDBC, UCP, and wallet-related dependencies

## Rules

- Keep datasource and wallet configuration externalized.
- Preserve actuator and metrics surfaces unless the task explicitly changes observability behavior.
- Use REST boundaries for service interactions; do not bury operational side effects in controller glue.
- Keep version and dependency changes intentional because both services are still on Spring Boot 2.7 and Java 11.

## Validation Paths

- `./gradlew test` inside `score/` or `replay/`
- `./gradlew bootRun` when runtime verification is needed
- deployment manifest review if ports, env vars, or probes change

## Typical Change Patterns

- API change: update callers, docs, and deployment config together.
- DB change: confirm credentials stay externalized and runtime config remains environment-specific.
- Metrics or health change: verify operational endpoints still support rollout and monitoring.
