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
