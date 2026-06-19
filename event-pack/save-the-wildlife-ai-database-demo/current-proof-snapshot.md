# Current Proof Snapshot

Last verified from the generated stage receipts on **2026-06-19 19:26 UTC**.

Use this file as the quick "what is live right now?" anchor. The generated
receipt remains the authority:

```bash
npm run check:conference-demo:stage
cat .codex_tmp/conference-stage-brief/latest.md
```

## Live Endpoints

- Game: `http://130.162.174.167/`
- PAF health: `http://130.162.174.167/paf/healthz`
- PAF match context API: `http://130.162.174.167/paf/api/context`
- PAF commentary API: `http://130.162.174.167/paf/api/commentary`
- PAF Canvas UI: `https://145.241.196.162:8080/agentFactory/`

## Current Runtime Deployment Proof

- Latest runtime-changing deploy commit: `307cc06`
- Build run: `stwl-build-codex-307cc06`
- Deploy run: `stwl-deploy-codex-307cc06`
- Stage verdict: `go_with_caveats`
- Game smoke: `ready`
- Transport smoke: `ready`
- Conference preflight: `ready_with_caveats`
- Model proof: `adapter_verdict=ready_with_upstream_llm_blocker`
- Strict upstream proof: `failed`, expected while both model routes report `behavior-adapter`

Note: the generated stage brief's `Verified commit` is the current repository
commit when the receipt is generated. It can be newer than `307cc06` after
docs-only event-pack commits. The runtime proof is the deployed image tags,
public smoke receipts, and the `stwl-deploy-codex-307cc06` rollout.

## Live Images

| Service | Current image tag |
|---|---|
| `web` | `0.0.22` |
| `ws-server` | `0.0.31` |
| `private-agent-factory` | `0.0.4` |
| `score` | `0.0.7` |
| `replay` | `0.0.1` |
| `model-ai-inference` | `latest` |

## Latest Playability Receipt

- Mobile: `RUNNING`, joystick `134x134`, boat visual `y=-0.063`, seat depth `0.066`
- Desktop: `RUNNING`, wake ripples `10`, boat visual `y=-0.063`, seat depth `0.066`
- Transport: public HTTP `200`, Socket.IO room lifecycle `pass`
- Recent `ws-server` logs after `server:0.0.31`: no `Session ID unknown`, no Coherence scan timeout burst

## Current AI Boundary

Safe to claim:

- The mobile/browser game is live on OCI and has fresh public smoke proof.
- PAF is deployed with the app and exposes health, context, and commentary APIs.
- PAF health reports Oracle, OCI Generative AI, Canvas config, Select AI, in-db agent path, graph/replay/vector retrieval, and model router configuration.
- Oracle AI Database is the grounded evidence path for SQL events, JSON event payloads, graph facts, replay metadata when present, vector-ready memory when present, traces, evals, and training examples.
- The harness returns bounded commentary with source metadata and trace persistence.

Keep gated:

- Do not claim two live private upstream LLM runtimes until strict upstream readiness passes.
- Do not claim a specific commentary line came from Canvas while response metadata says `canvas:null`.
- Do not claim a specific commentary line used the in-db agent while response metadata says `in_db_agent:null`.
- Do not claim replay-caption or vector-memory evidence for a smoke call when the receipt count is zero.
- Do not say the model watched raw gameplay footage. It receives bounded evidence and clip pointers.

## Stage Line

> The game path is green. The AI path is green with honest caveats. Proof first, claim second.
