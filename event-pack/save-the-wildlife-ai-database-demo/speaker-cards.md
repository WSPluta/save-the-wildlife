# Speaker Cards

## 15-Second Core

We turned a live mobile game into a match-intelligence template: real events and replay clips go into Oracle AI Database, SQL/JSON/graph/vector context grounds the agent, Oracle Private Agent Factory Canvas shapes the final commentary, and the harness broadcasts it back into the live experience.

## 45-Second Core

This game is a signal generator. Every powerup, trail crossing, freeze, coordinate, score, and replay clip becomes evidence in Oracle AI Database. The agent does not guess from raw footage; it reads the event timeline, replay manifest, graph facts, and memory. The in-database package summarizes the session, Select AI can generate a short draft from grounded context, and Oracle Private Agent Factory Canvas polishes live commentary, replay captions, or recap text. The broader lesson is Canvas plus harness: business users can shape the agent experience, and AI engineers keep it grounded, governed, and connected to the live 3D environment.

## Transition: Game To Data

You just saw gameplay. Now strip away the visuals. What remains is an event timeline: who did what, where, when, with which powerup, and what changed because of it. That is exactly the kind of substrate enterprise agents need.

## Transition: Replay To Production

At demo scale, the replay is a JSON clip captured in the browser. At production scale, that becomes an object-storage clip with a thumbnail, timecode, moderation status, and semantic tags. The model still does not need to watch everything. It gets the evidence package and the clip pointer.

## Transition: Data To Agent

Once the event stream is in Oracle AI Database, the question changes. We are no longer asking a model to be creative from nowhere. We are asking it to phrase a bounded answer from governed context.

## Transition: Agent To Harness

The agent is not the model. The model emits tokens. Canvas shapes the agent experience. The harness decides what context exists, what tools are callable, what memory is retrieved, what identity applies, when the loop must stop, and what gets broadcast back into the app.

## Objection Handling

**Is this just a game demo?**
No. The game is a memorable event generator. The reusable pattern is event capture, SQL grounding, governed memory, bounded generation, and traceable agent behavior.

**Why not let the LLM read raw logs?**
Because the runtime needs deterministic grounding. SQL decides what happened. The LLM phrases it under constraints.

**Why Oracle AI Database?**
Because the same platform can hold relational match facts, JSON replay documents, graph relationships, vector memory, Select AI profiles, in-database agent calls, and governed access controls.

**Where does PAF fit?**
PAF is the agent workflow and Canvas experience. In this demo it receives a bounded evidence package and produces the final conference-safe live line, replay caption, or recap. The harness is still the production connection to SQL evidence, Select AI or in-database drafts, policy, and the live game.

**Is this really a gaming industry pattern?**
Yes. The demo is small, but the shape is production-friendly: event SDK, replay manifest, match graph, vector memories, moderation, output policies, and human override for broadcast workflows.

**Where does Select AI fit?**
Select AI is the natural-language-over-data layer. In the runtime path we keep SQL explicit and bounded, then use Select AI for controlled summarization and presenter-facing exploration.

**What makes this enterprise-ready?**
The harness pattern: scoped memory, deterministic tools, output limits, traceable context, fallback paths, and database-enforced governance.

## Phrases Worth Reusing

- The game is the wrapper; the event stream is the product.
- Telemetry explains what happened. Replay shows it. Oracle AI Database connects both.
- SQL decides what happened. The model decides how to say it.
- Graph explains relationships. Vector finds similar moments.
- The harness is where agent quality becomes engineering.
- Canvas lets the business shape the agent. The harness keeps it connected, governed, and live.
- Memory should be compressed or superseded, not silently erased.
- Scoped retrieval is not safe until you prove it does not leak.
- If an event is not in the database, the commentator should not invent it.
- The modern agent stack is not one giant prompt. It is a small loop around governed data.

## Final Close

Start with real events. Pair them with replay evidence. Store both where governance already lives. Retrieve context deliberately. Let the model phrase, not fabricate. That is the path from a demo game to production live commentary and replay products.
