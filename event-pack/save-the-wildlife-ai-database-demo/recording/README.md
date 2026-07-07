# Demo Recording Kit

This kit creates a short rehearsal recording for the Save the Wildlife match-intelligence demo. It is designed to help land the story cleanly before the 18-minute live talk.

The recording is not a generic product video. It uses real repo snippets and the same technical argument you should make on stage:

- the game is the signal generator
- Oracle AI Database is the governed match intelligence layer
- SQL decides facts
- JSON carries replay evidence
- graph explains relationships
- vector memory finds similar prior moments
- Select AI and in-database agents help summarize
- Oracle Private Agent Factory Canvas turns bounded evidence into conference-safe language

## Build

From the repo root:

```bash
node scripts/build_demo_recording.mjs
```

The script generates:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/save-the-wildlife-match-intelligence-rehearsal.mp4`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/save-the-wildlife-match-intelligence-rehearsal.srt`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/source-map.md`
- rendered frames under `event-pack/save-the-wildlife-ai-database-demo/recording/output/frames/`

The current conference fallback artifact is:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/save-the-wildlife-match-intelligence-with-commentary-proof.mp4`

That file stitches the rehearsal recording together with a public `http://130.162.174.167` commentary proof segment. The final segment shows `/admin/ai-learning` receiving seeded gameplay telemetry through `game.event`, then rendering grouped `select-ai` commentary lines from the deployed Private Agent Factory adapter.

The current multiplayer gameplay proof artifact is:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/multiplayer-gameplay-proof/save-the-wildlife-public-multiplayer-gameplay-proof.mp4`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/multiplayer-gameplay-proof-synced/save-the-wildlife-public-multiplayer-gameplay-proof.mp4`

The `multiplayer-gameplay-proof-synced` file records four browser clients in the same public room on `http://130.162.174.167`, started through the admin websocket path, then trims each quadrant to the server-running timestamp so the video is visually aligned. The paired `recording-report.md` proves every client reached `RUNNING`, saw the other human players, and observed the driver moving remotely with zero large jumps.

The current stage fallback artifact is:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-fallback/save-the-wildlife-public-gameplay-with-commentary-ending.mp4`

That file combines the synced public multiplayer proof with a final `/admin/ai-learning` commentary proof segment. Use this if the live room flow is too risky on stage: it still shows public OKE gameplay first, then ends on `game.event -> Oracle AI Database -> Select AI` commentary lines from the deployed Private Agent Factory adapter.

The preferred same-room competition proof artifact is:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof/save-the-wildlife-same-room-competition-commentary-proof.mp4`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof/recording-report.md`

That file records four real browser clients in one public room on `http://130.162.174.167`, shows the shared room roster, proves every quadrant sees the other three human players, broadcasts real server item pickups/removals, and ends on the `/admin/ai-learning` commentary list for the same room. The run produced four different bounded commentary lines from the deployed Select AI path.

The next capture layout uses the same recorder but switches the proof composition to three named players plus a fourth `/admin/observability` quadrant. The game clients use the normal public gameplay URL; the recorder adds video-only player badges and a local-boat marker so the MP4 clearly identifies Demo Alpha, Demo Bravo, and Demo Charlie even when the in-world name sprite is small. The observability quadrant shows six live signals: connected users, room state, latency, item stream, commentary job, and latest commentary.

Fresh public capture generated on 2026-06-29:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof-20260629-053018/save-the-wildlife-same-room-competition-commentary-proof.mp4`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof-20260629-053018/recording-report.md`

This is the preferred stage-safe recording. It uses `http://130.162.174.167`, room `DEMO-STAGE-231318`, three gameplay browser quadrants plus one public `/admin/observability` browser quadrant, starts at the countdown, removes local self-name markers and bottom proof text, shows multiplayer gameplay/pickups/freeze evidence, and ends with live commentary overlays rendered in the same four-quadrant recording.

Previous four-gameplay draft generated on 2026-06-29:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof-20260629-051617/save-the-wildlife-same-room-competition-commentary-proof.mp4`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof-20260629-051617/recording-report.md`

This draft uses four gameplay quadrants and is kept only as backup. Prefer the `20260629-053018` recording because it matches the requested three players plus observability layout.

Previous public capture generated on 2026-06-29:

- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof-20260629-050332/save-the-wildlife-same-room-competition-commentary-proof.mp4`
- `event-pack/save-the-wildlife-ai-database-demo/recording/output/stage-multiplayer-commentary-proof-20260629-050332/recording-report.md`

This capture uses `http://130.162.174.167`, room `DEMO-STAGE-621292`, three game players plus the public observability quadrant, and ends on three grouped commentary lines from Select AI / Select AI guarded output.

The MP4 is silent by default and has a matching subtitle file. Record your voice over it, or use it as a rehearsal player while reading `demo-recording-script.md`.

## Add A Voice Track Later

If you record narration as `voiceover.m4a`, mux it onto the generated video:

```bash
ffmpeg -y \
  -i event-pack/save-the-wildlife-ai-database-demo/recording/output/save-the-wildlife-match-intelligence-rehearsal.mp4 \
  -i voiceover.m4a \
  -map 0:v:0 -map 1:a:0 \
  -shortest -c:v copy -c:a aac \
  event-pack/save-the-wildlife-ai-database-demo/recording/output/save-the-wildlife-match-intelligence-rehearsal-voiced.mp4
```

## How To Use It

1. Watch the MP4 once without talking.
2. Read the script aloud with the video.
3. Cut any phrase that feels too polished.
4. Keep the proof points:
   - mobile play works
   - mechanics are captured as events
   - PAF context is evidence-first
   - in-database agents and Select AI are bounded by SQL evidence
   - tests cover the claims you make

The goal is not to memorise every line. The goal is to know the structure well enough that the live demo feels like a working system, not a hopeful narrative.
