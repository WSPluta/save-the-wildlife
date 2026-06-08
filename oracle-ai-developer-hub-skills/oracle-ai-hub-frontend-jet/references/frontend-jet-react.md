# Frontend Oracle JET + React Reference

Converted from:

- `frontend-jet-react-conventions.md`

## Scope

Applies to Oracle JET 19.x, React, and TypeScript frontend code, especially:

- components
- shared libs
- styles
- WebSocket or STOMP clients
- frontend config files

## Core Rules

- Use strict TypeScript and explicit props or interfaces.
- Keep files and imports consistent with the existing project structure.
- Co-locate helpers unless they clearly belong in a shared library.
- Use semantic HTML and accessible labels or attributes.

## Hooks And Effects

- Type state and derived values.
- Ensure `useEffect` has accurate dependencies.
- Cancel async work or disconnect subscriptions on cleanup.
- Treat WebSocket lifecycle as a first-class concern: connect deliberately, handle errors, and disconnect on unmount.

## Styling And Performance

- Reuse existing style locations and naming patterns.
- Avoid needless rerenders by narrowing props and memoizing only when it helps a real hot path.
- Keep assets and classes aligned with existing conventions.

## Safe Change Patterns

- Add optional props with defaults instead of breaking callers.
- Update all call sites when a component contract changes.
- Keep model labels stable and human-readable.
- Show user-facing loading and error states instead of failing silently.

## Validation

- Build or typecheck the frontend surface you changed.
- Check UI behavior in the relevant screen.
- Re-scan for impacted classes, selectors, or component imports.
- Confirm accessibility did not regress.
