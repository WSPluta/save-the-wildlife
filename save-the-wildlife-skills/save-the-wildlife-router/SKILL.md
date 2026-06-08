---
name: save-the-wildlife-router
description: Use when working in the Save The Wildlife repository and you need to choose the right skill for the Three.js web client, Socket.IO game server, Spring score or replay services, build and release scripts, platform delivery, or OCI DevOps workshop flows.
---

# Save The Wildlife Router

This is the entry skill for the Save The Wildlife repository.

## Route By Task

- Repo-wide safety, minimal diffs, versioning expectations, or cross-service coordination:
  `../save-the-wildlife-core-guardrails/SKILL.md`
- Three.js frontend, webpack bundles, browser gameplay behavior, or multiplayer rendering:
  `../save-the-wildlife-web-gameplay/SKILL.md`
- Socket.IO server, object lifecycle, room state, distributed backend toggles, or metrics:
  `../save-the-wildlife-realtime-server/SKILL.md`
- Spring Boot `score` or `replay` service work, REST endpoints, JDBC or Oracle DB integration:
  `../save-the-wildlife-spring-services/SKILL.md`
- Build, bump, release, local dev startup, or script changes:
  `../save-the-wildlife-release-and-dev-scripts/SKILL.md`
- Kubernetes, Terraform, OCI deployment, VM rollout, or environment overlays:
  `../save-the-wildlife-platform-delivery/SKILL.md`
- OCI DevOps workshop and `livelabs/safethewildlife/devops/**` authoring or verification:
  `../save-the-wildlife-devops-workshop/SKILL.md`

## Pairing Rules

- Feature work touching browser and server should load both web and realtime server skills.
- Feature work affecting server and score persistence should load realtime server and spring services skills.
- Deployment work that changes build artifacts or versions should also load the release-and-dev-scripts skill.
- For browser-playtest loops, pair the gameplay skill with the existing `develop-web-game` skill.
- For OCI DevOps production flow verification, pair the workshop skill with the existing `oci-devops-prod-deploy` skill when relevant.

## Source Coverage

This skill pack was derived from:

- `.clinerules/save-the-wildlife.md`
- `.clinerules/save-the-wildlife-updated.md`
- live repo structure and scripts in `web/`, `server/`, `score/`, `replay/`, `deploy/`, `scripts/`, and `livelabs/`
