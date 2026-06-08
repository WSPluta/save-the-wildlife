---
name: oracle-ai-hub-frontend-jet
description: Use when editing Oracle JET, React, or TypeScript frontend code in the OCI Generative AI JET UI repository, including components, settings pages, STOMP/WebSocket behavior, styles, and frontend configuration.
---

# Oracle AI Hub Frontend JET

Use this skill for `app/` work and any UI changes tightly coupled to model settings or backend APIs.

## Read First

Read `references/frontend-jet-react.md` before making component or config changes.

## Workflow

1. Search for impacted components, styles, and shared libs before editing.
2. Preserve Oracle JET and TypeScript configuration files unless the task explicitly requires config changes.
3. Prefer explicit types, typed props, and predictable state transitions.
4. Keep `useEffect` dependencies accurate and always clean up async or WebSocket side effects.
5. When touching settings or model selection UI, pair this skill with `../oracle-ai-hub-genai-config/SKILL.md`.
6. Validate with the lightest meaningful check, then confirm accessibility and compatibility.

## Non-Negotiables

- No `any` unless there is a strong, documented reason.
- No secret values in config or UI state.
- No unsafe HTML shortcuts when a typed render path exists.
- No broad file rewrites for small prop or handler changes.
