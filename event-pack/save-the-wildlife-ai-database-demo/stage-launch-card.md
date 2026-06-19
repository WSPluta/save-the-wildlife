# Stage Launch Card

Use this as the final operator surface before and during the 18-minute talk.
The goal is simple: reduce stage friction. Open the right tabs, run the right
receipts, say only what the evidence proves.

## Open These First

1. Deck: [save-the-wildlife-ai-engineer-demo-deck.pptx](../../outputs/save-the-wildlife-ai-engineer-demo-deck.pptx)
2. Audience entry: [stage-entry.html](stage-entry.html)
3. Live stage brief: `.codex_tmp/conference-stage-brief/latest.md`
4. Operator console: [stage-console.md](stage-console.md)
5. Master card: [ai-engineer-demo-master-card.md](ai-engineer-demo-master-card.md)
6. PAF Canvas: `https://145.241.196.162:8080/agentFactory/`

## Run Before Walking On

```bash
npm run check:conference-demo:transport
npm run check:conference-demo:game
npm run check:conference-demo:stage -- --skip-refresh
```

Expected stage posture:

- Transport: `ready`
- Game smoke: `ready`
- Stage brief: `go_with_caveats` or better
- Mobile: `RUNNING`, joystick visible, boat seated at the waterline
- PAF health: pass
- Current strict model boundary: adapter mode until upstream proof passes

## First 90 Seconds

Say:

> Before we talk about agents, databases, or infrastructure, I want you to
> create the data.
>
> Open the game on your phone. Move the boat, collect items, grab a powerup,
> and try not to cross another player's trail.
>
> In two minutes, this room will create a live event stream: coordinates,
> collisions, powerups, freezes, score changes, and replay moments.
>
> The model is not guessing. SQL decides what happened. The model only gets to
> decide how to say it.

Then stop talking and let the room play.

## Proof Ladder

Use this order if someone technical challenges the demo:

1. **Modern app proof:** the mobile/browser game is live on OCI and reaches
   `RUNNING`.
2. **Realtime proof:** Socket.IO room lifecycle passes and Coherence fans out
   room events without a Redis tier.
3. **Database proof:** Oracle AI Database stores gameplay events, coordinates,
   JSON metadata, graph facts, and vector-ready memory.
4. **Agent proof:** PAF exposes health, context, and commentary endpoints.
5. **Harness proof:** commentary includes source metadata, guardrails, fallback
   path, and persisted trace.
6. **Boundary proof:** Canvas and in-db agents are configured, but a specific
   line is only a Canvas or in-db line when response metadata says so.

## Lines To Land

- The frontend proves Oracle can run a modern interactive app.
- Oracle AI Database proves the AI has operational truth.
- The harness proves the model is not allowed to outrun the evidence.
- Canvas lets the business shape the agent experience; engineers own the
  harness around data, tools, policy, memory, and live systems.
- A bigger context window is not memory. A vector table is not memory.
  Production memory needs scope, provenance, deletion, retrieval, and tests.

## Do Not Overclaim

- Do not say the model watched raw gameplay footage.
- Do not say Canvas produced the exact smoke line when `canvas` is `null`.
- Do not say the in-db agent produced the exact smoke line when `in_db_agent`
  is `null`.
- Do not claim replay or vector evidence for a smoke call when counts are zero.
- Do not claim two live private upstream LLMs until strict upstream proof passes.

## If The Room Wi-Fi Misbehaves

Say:

> I have a smoke session because the pattern matters more than Wi-Fi bravery.
> The same event ledger, context API, commentary guardrails, and source metadata
> are still provable.

Then run:

```bash
curl -sS -X POST http://130.162.174.167/paf/api/commentary \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"SMOKE-INDB-20260610-02","player_id":"P-SMOKE","max_chars":200}'
```

## Close

Say:

> SQL decides what happened. The model decides how to say it. The harness
> decides whether it is allowed to say it.
