# 18-Minute Run Of Show

## Talk Title

**From Live Game Events to Match Intelligence with Oracle AI Database**

## Timing

| Time | Segment | Goal | What You Show |
|---:|---|---|---|
| 0:00-0:45 | Cold open | Wake the room up | QR / URL for the game |
| 0:45-2:30 | Audience play | Make the data real | Players join on mobile and move |
| 2:30-4:00 | Reveal the telemetry | Reframe game actions as events | Event timeline slide |
| 4:00-5:45 | Why Oracle AI Database | Ground match intelligence in governed data | SQL/JSON/graph/vector lenses |
| 5:45-7:30 | Live commentary and replay | Prove the PAF/harness evidence path | PAF context + commentary API result |
| 7:30-9:30 | Architecture | Explain business-shaped agent plus engineering harness | Game -> evidence -> Select AI/in-db agent -> PAF/Canvas/harness |
| 9:30-12:00 | Agent construction | Explain harness vs model | Agent = Model + Harness |
| 12:00-14:30 | Harness patterns | Give AI developers reusable ideas | memory, tool retrieval, offload, identity |
| 14:30-16:30 | Notebook CTAs | Turn demo into learning path | three notebooks and what each proves |
| 16:30-18:00 | Close | Land the modern Oracle AI Database view | repeat pattern and CTA |

## Opening Beat

Say:

> Before I show you architecture, I want you to create the data. Open this on your phone. In two minutes, your movement, powerups, trail crossings, freezes, and replay moments will become the context for live match intelligence.

Keep it playful but controlled. You do not need everyone to play. You need enough motion to make the room feel that the data is live.

For the fuller limbic opening and proof ladder, use
[ai-engineer-presenter-card.md](ai-engineer-presenter-card.md).

For the live terminal and source-metadata flow, keep
[stage-console.md](stage-console.md) open next to the browser.

For full rehearsal, read
[18-minute-stage-script.md](18-minute-stage-script.md) out loud once. It is the timing-safe script with proof boundaries and rescue lines.

## Core Narrative Arc

1. **Play:** The room creates telemetry.
2. **Prove:** Oracle AI Database stores and summarizes the telemetry.
3. **Agent:** Oracle Private Agent Factory is deployed with Canvas configured, while response metadata decides which runtime path produced a specific line.
4. **Harness:** The endpoint harness connects SQL evidence, Select AI or in-database agent drafts, replay context, model-router adapters, Canvas configuration, deterministic fallback, and the live 3D game.
5. **Generalize:** Business users can shape agents in Canvas while AI engineers own the governed harness around live systems.

## Canvas Plus Harness Beat

Use this as the transition into architecture:

> Here is the enterprise pattern hiding inside the game. The agent experience can be shaped in Canvas by the people closest to the business language. The AI engineering work is the harness: connect it to the live system, build the SQL evidence package, route bounded drafts through Select AI, in-database agents, model adapters, or deterministic fallback, enforce policy, and broadcast only grounded commentary back into the experience.

## Time Discipline

If audience play takes longer than expected, cut Slide 8 short. Do not cut the live commentary proof or the harness framing.

If the live game is quiet, use the smoke session:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

Expected proof:

- `warning` is `null`
- `source`, `fallback_source`, `model_route`, `canvas`, and `in_db_agent` identify the actual runtime path
- current no-spend proof can show `source=oci-base`, `fallback_source=oracle-sql`, and `runtime_mode=behavior-adapter`
- `summary` includes `powerup_shield`, `trail_crosses`, `freezes`, and coordinates

## Closing Line

> The game is the memorable wrapper. The pattern is the point: Canvas gives business users a way to shape the agent, and the harness gives engineers a way to keep it grounded in real events, replay evidence, governed memory, deterministic tools, and live production systems.
