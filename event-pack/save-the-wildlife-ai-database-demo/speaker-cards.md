# Speaker Cards

## 15-Second Core

We turned a live mobile game into a match-intelligence template: real events and replay clips go into Oracle AI Database, SQL/JSON/graph/vector context grounds the agent, Canvas shapes the experience, and the harness records which runtime path produced the final commentary before broadcasting it back into the game.

## 45-Second Core

This game is a signal generator. Every powerup, trail crossing, freeze, coordinate, score, and replay clip becomes evidence in Oracle AI Database. The agent does not guess from raw footage; it reads the event timeline, replay manifest, graph facts, and memory. The in-database package summarizes the session, Select AI can generate a short draft from grounded context, Canvas gives business users the agent-shaping surface, and the harness records whether a specific line came from Canvas, an in-database agent, Select AI, the model router, or SQL fallback. The broader lesson is Canvas plus harness: business users can shape the agent experience, and AI engineers keep it grounded, governed, and connected to the live 3D environment.

## Current Proof Posture

**15-second version**
Use `.codex_tmp/conference-stage-brief/latest.md` as the authority. The transport path proves public HTTP and Socket.IO room lifecycle only when its receipt is ready. The visual/mobile game claim requires a passing game smoke or manual visual proof from a normal browser. The AI path is ready with caveats: PAF health, Oracle AI Database evidence, Select AI, in-db agent configuration, model routing, trace persistence, and adapter proof pass; replay/vector rows and exact Canvas generation are claim-boundary items for the smoke response.

**What to say if challenged**
The honest answer is better than the polished one. PAF is live, transport is live when the receipt says so, and the visual game path is a separate browser proof. For a specific commentary line, I trust the metadata: if `canvas:null`, I do not claim Canvas generated it.

## Transition: Game To Data

You just saw gameplay. Now strip away the visuals. What remains is an event timeline: who did what, where, when, with which powerup, and what changed because of it. That is exactly the kind of substrate enterprise agents need.

## Transition: Replay To Production

At demo scale, the replay is a JSON clip captured in the browser. At production scale, that becomes an object-storage clip with a thumbnail, timecode, moderation status, and semantic tags. The model still does not need to watch everything. It gets the evidence package and the clip pointer.

## Transition: Data To Agent

Once the event stream is in Oracle AI Database, the question changes. We are no longer asking a model to be creative from nowhere. We are asking it to phrase a bounded answer from governed context.

## Transition: Agent To Harness

The agent is not the model. The model emits tokens. Canvas shapes the agent experience. The harness decides what context exists, what tools are callable, what memory is retrieved, what identity applies, when the loop must stop, and what gets broadcast back into the app.

## Model AI Proof Cards

**15-second version**
Tier 1000 proves the harness. `upstream formats openai:2` proves both private routes are ready to carry evidence-bearing calls to upstream LLMs. The strict upstream gate proves the actual two-LLM claim, and that gate is still intentionally blocked until both routes report `runtime_mode=upstream-llm`.

**45-second version**
The live system now has a shadow route from `oci-base` to `oci-fine-tuned`, Oracle AI Database trace and evidence tables, redacted behavior-only training export, trainer dry-run proof, and a public admin page showing `upstream formats openai:2`. That means the agent harness and adapter handoff are live. It does not mean the GPU-backed vanilla and fine-tuned LLMs are live yet. The clean line is: facts stay in Oracle AI Database memory, behavior moves into weights only after the strict upstream runtime gate passes.

**What the handoff proves**
It proves the private adapters can pass trace ID, route context, prompt hash, evidence hash, and Oracle AI Database evidence references into an OpenAI-compatible upstream call. It does not prove an upstream model served the response.

**What the strict gate proves**
It fails if either route still reports `behavior-adapter`, misses model metadata, or marks `upstream_configured=false`. When it passes, the demo can claim two live private LLM runtimes.

**What to say if challenged**
Not yet live as two LLMs. Live today: PAF route, admin proof, tier-1000 canary, governed DB evidence, training export, trainer dry-run, and OpenAI-compatible adapter handoff. Pending: private upstream base and fine-tuned model runtimes.

## Objection Handling

**Is this just a game demo?**
No. The game is a memorable event generator. The reusable pattern is event capture, SQL grounding, governed memory, bounded generation, and traceable agent behavior.

**Why not let the LLM read raw logs?**
Because the runtime needs deterministic grounding. SQL decides what happened. The LLM phrases it under constraints.

**Why Oracle AI Database?**
Because the same platform can hold relational match facts, JSON replay documents, graph relationships, vector memory, Select AI profiles, in-database agent calls, and governed access controls.

**Where does PAF fit?**
PAF is the deployed agent workflow service and Canvas experience. In this demo it receives a bounded evidence package and can produce conference-safe live lines, replay captions, or recaps through the configured route. The harness is still the production connection to SQL evidence, Select AI or in-database drafts, policy, metadata, fallback, and the live game.

**Is this really a gaming industry pattern?**
Yes. The demo is small, but the shape is production-friendly: event SDK, replay manifest, match graph, vector memories, moderation, output policies, and human override for broadcast workflows.

**Where does Select AI fit?**
Select AI is the natural-language-over-data layer. In the runtime path we keep SQL explicit and bounded, then use Select AI for controlled summarization and presenter-facing exploration.

**What makes this enterprise-ready?**
The harness pattern: scoped memory, deterministic tools, output limits, traceable context, fallback paths, and database-enforced governance.

**Is this really fine-tuned yet?**
Not in the live runtime. The behavior-only training path and dry-run are ready, and the private adapters expose the OpenAI-compatible handoff. The live claim remains adapter-mode until the strict upstream gate passes.

**What should the fine-tune learn?**
Stable behavior: concise commentary shape, evidence citation, confidence discipline, safe phrasing, and token efficiency. Changing game facts stay in Oracle AI Database.

## Phrases Worth Reusing

- The game is the wrapper; the event stream is the product.
- Telemetry explains what happened. Replay shows it. Oracle AI Database connects both.
- SQL decides what happened. The model decides how to say it.
- Metadata proves which path produced the line.
- Graph explains relationships. Vector finds similar moments.
- The harness is where agent quality becomes engineering.
- Canvas lets the business shape the agent. The harness keeps it connected, governed, and live.
- Memory should be compressed or superseded, not silently erased.
- Scoped retrieval is not safe until you prove it does not leak.
- If an event is not in the database, the commentator should not invent it.
- The modern agent stack is not one giant prompt. It is a small loop around governed data.
- Facts in memory, behavior in weights.
- Tier 1000 proves the harness; upstream runtime proves the two LLMs.
- OpenAI-compatible handoff is live; upstream LLM runtime is still pending.
- SQL decides what happened. The model decides how to say it. The harness decides whether it is allowed to say it.

## Final Close

Start with real events. Pair them with replay evidence. Store both where governance already lives. Retrieve context deliberately. Let the model phrase, not fabricate. That is the path from a demo game to production live commentary and replay products.
