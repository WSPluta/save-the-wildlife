---
name: save-the-wildlife-spring-services
description: Use when editing the Save The Wildlife Spring Boot services in score or replay, including REST endpoints, Actuator, Oracle JDBC or UCP usage, Prometheus metrics, and service integration with the multiplayer server.
---

# Save The Wildlife Spring Services

Use this skill for `score/` and `replay/` work.

## Read First

Read `references/spring-services.md` before changing endpoints, datasource behavior, or service contracts.

## Workflow

1. Decide whether the task affects `score`, `replay`, or both.
2. Keep service boundaries explicit and avoid mixing game-loop logic into Spring services.
3. Preserve Spring Boot, Java, and Oracle JDBC compatibility.
4. Externalize credentials and wallet-dependent config.
5. Validate with Gradle tests or boot verification before wider rollout.

## Pairing

- Pair with `../save-the-wildlife-realtime-server/SKILL.md` for persistence-affecting gameplay changes.
- Pair with `../save-the-wildlife-platform-delivery/SKILL.md` for deployment or secret wiring changes.
