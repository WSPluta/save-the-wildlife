import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const recordingDir = path.join(repoRoot, "event-pack/save-the-wildlife-ai-database-demo/recording");
const storyboardPath = path.join(recordingDir, "demo-recording-storyboard.json");
const outputDir = path.join(recordingDir, "output");
const framesDir = path.join(outputDir, "frames");
const svgDir = path.join(framesDir, "svg");
const thumbDir = path.join(framesDir, "thumbs");
const pngDir = path.join(framesDir, "png");

const WIDTH = 1920;
const HEIGHT = 1080;
const COLORS = {
  charcoal: "#172026",
  charcoal2: "#22313a",
  ivory: "#f8f3e7",
  ink: "#13201f",
  teal: "#10b7a3",
  sky: "#68c5e8",
  pine: "#1f5b43",
  oracleRed: "#c74634",
  amber: "#f2a23a",
  muted: "#c8d6d2",
  codeBg: "#0b1317",
  line: "#31525a"
};

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(text, maxChars) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function readSnippet(snippet) {
  if (!snippet) return null;
  const filePath = path.join(repoRoot, snippet.file);
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const selected = lines.slice(snippet.start - 1, snippet.end);
  const maxCodeChars = 62;
  return {
    ...snippet,
    absolutePath: filePath,
    lines: selected.map((line, index) => ({
      number: snippet.start + index,
      text: line.length > maxCodeChars ? `${line.slice(0, maxCodeChars - 3)}...` : line
    }))
  };
}

function textBlock(lines, { x, y, size = 34, fill = COLORS.ivory, lineHeight = 44, weight = 400, family = "Arial" }) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
  )).join("\n");
}

function bulletBlock(bullets, x, y) {
  return bullets.map((bullet, index) => {
    const yBase = y + index * 76;
    const wrapped = wrapText(bullet, 53);
    const text = textBlock(wrapped, { x: x + 34, y: yBase, size: 30, fill: COLORS.ivory, lineHeight: 36 });
    return `
      <circle cx="${x}" cy="${yBase - 9}" r="8" fill="${index === 0 ? COLORS.teal : COLORS.sky}" />
      ${text}
    `;
  }).join("\n");
}

function codeBlock(snippet, x, y, width, height) {
  if (!snippet) {
    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="${COLORS.codeBg}" stroke="${COLORS.line}" />
      ${textBlock(["No code snippet on this beat.", "Use this as the close and CTA."], { x: x + 34, y: y + 80, size: 32, fill: COLORS.muted, lineHeight: 46 })}
    `;
  }

  const maxLines = Math.floor((height - 128) / 30);
  const visible = snippet.lines.slice(0, maxLines);
  const lineText = visible.map((line) => `${String(line.number).padStart(4, " ")}  ${line.text}`);
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="${COLORS.codeBg}" stroke="${COLORS.line}" />
    <rect x="${x}" y="${y}" width="${width}" height="58" rx="16" fill="#0f2026" />
    <text x="${x + 26}" y="${y + 38}" font-family="Arial" font-size="24" font-weight="700" fill="${COLORS.teal}">${escapeXml(snippet.file)}</text>
    <text x="${x + width - 250}" y="${y + 38}" font-family="Arial" font-size="22" fill="${COLORS.muted}">lines ${snippet.start}-${snippet.end}</text>
    ${textBlock(lineText, { x: x + 28, y: y + 96, size: 23, fill: "#e7efe9", lineHeight: 30, family: "Menlo, Consolas, monospace" })}
    <text x="${x + 26}" y="${y + height - 28}" font-family="Arial" font-size="23" fill="${COLORS.sky}">${escapeXml(snippet.caption)}</text>
  `;
}

function renderSlideSvg(storyboard, slide, index, total) {
  const snippet = readSnippet(slide.snippet);
  const hasCode = Boolean(snippet);
  const time = `${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
  const titleLines = wrapText(slide.title, 22);
  const claimLines = wrapText(slide.claim, 47);
  const argumentLines = wrapText(slide.technicalArgument, 70).slice(0, 3);
  const leftW = 800;
  const codeX = 930;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${WIDTH}" viewBox="0 0 ${WIDTH} ${WIDTH}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLORS.charcoal}" />
      <stop offset="64%" stop-color="${COLORS.charcoal2}" />
      <stop offset="100%" stop-color="#0f171b" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${WIDTH}" fill="url(#bg)" />
  <rect x="0" y="0" width="18" height="${WIDTH}" fill="${COLORS.teal}" />
  <rect x="18" y="0" width="7" height="${WIDTH}" fill="${COLORS.oracleRed}" opacity="0.78" />
  <text x="76" y="76" font-family="Arial" font-size="26" font-weight="700" letter-spacing="0" fill="${COLORS.teal}">${escapeXml(slide.eyebrow)}</text>
  <text x="1710" y="76" font-family="Arial" font-size="24" fill="${COLORS.muted}">${escapeXml(time)}</text>
  ${textBlock(titleLines, { x: 76, y: 172, size: 70, fill: COLORS.ivory, lineHeight: 78, weight: 800 })}
  ${textBlock(claimLines, { x: 80, y: 330 + Math.max(0, titleLines.length - 1) * 68, size: 36, fill: COLORS.sky, lineHeight: 46, weight: 700 })}
  <line x1="80" y1="456" x2="${leftW}" y2="456" stroke="${COLORS.teal}" stroke-width="4" opacity="0.75" />
  ${bulletBlock(slide.bullets, 94, 526)}
  <rect x="80" y="820" width="${leftW}" height="126" rx="16" fill="#20363a" stroke="${COLORS.line}" />
  <text x="112" y="864" font-family="Arial" font-size="23" font-weight="700" fill="${COLORS.amber}">Technical argument</text>
  ${textBlock(argumentLines, { x: 112, y: 904, size: 25, fill: COLORS.ivory, lineHeight: 32 })}
  ${hasCode ? codeBlock(snippet, codeX, 138, 900, 810) : `
    <rect x="930" y="156" width="826" height="650" rx="24" fill="#0f171b" stroke="${COLORS.line}" />
    <text x="982" y="240" font-family="Arial" font-size="40" font-weight="800" fill="${COLORS.teal}">Capture - Ground - Govern - Act</text>
    ${textBlock(["Real events", "Replay evidence", "Oracle AI Database", "Bounded agent output"], { x: 1020, y: 342, size: 42, fill: COLORS.ivory, lineHeight: 88, weight: 700 })}
    ${textBlock(wrapText("Proof-led rehearsal recording for Oracle AI Database + PAF.", 48), { x: 982, y: 720, size: 27, fill: COLORS.sky, lineHeight: 36 })}
  `}
  <text x="76" y="1014" font-family="Arial" font-size="22" fill="${COLORS.muted}">Save the Wildlife | Live match intelligence from gameplay truth | Oracle AI Database + PAF</text>
</svg>`;
}

function srtTime(seconds) {
  const ms = Math.round((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function writeSubtitles(storyboard, outputBase) {
  let cursor = 0;
  const parts = [];
  storyboard.slides.forEach((slide, index) => {
    const start = cursor;
    const end = cursor + slide.duration;
    cursor = end;
    const lines = wrapText(slide.talkTrack, 78);
    parts.push(`${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${lines.join("\n")}\n`);
  });
  const srtPath = path.join(outputDir, `${outputBase}.srt`);
  writeFileSync(srtPath, parts.join("\n"));
  return srtPath;
}

function writeSourceMap(storyboard) {
  const lines = [
    "# Demo Recording Source Map",
    "",
    "Every code claim in the rehearsal video points at a real source range.",
    ""
  ];

  storyboard.slides.forEach((slide, index) => {
    lines.push(`## ${index + 1}. ${slide.title}`);
    lines.push("");
    lines.push(`- Claim: ${slide.claim}`);
    lines.push(`- Technical argument: ${slide.technicalArgument}`);
    if (slide.snippet) {
      lines.push(`- Source: \`${slide.snippet.file}:${slide.snippet.start}-${slide.snippet.end}\``);
      lines.push(`- Why it matters: ${slide.snippet.caption}`);
    } else {
      lines.push("- Source: no code snippet; close/CTA slide.");
    }
    lines.push("");
  });

  const sourceMapPath = path.join(outputDir, "source-map.md");
  writeFileSync(sourceMapPath, lines.join("\n"));
  return sourceMapPath;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed\n${details}`);
  }
  return result;
}

function renderFrames(storyboard) {
  const pngPaths = [];
  storyboard.slides.forEach((slide, index) => {
    const number = String(index + 1).padStart(2, "0");
    const svgPath = path.join(svgDir, `slide-${number}.svg`);
    const thumbPng = path.join(thumbDir, `slide-${number}.svg.png`);
    const pngPath = path.join(pngDir, `slide-${number}.png`);

    writeFileSync(svgPath, renderSlideSvg(storyboard, slide, index, storyboard.slides.length));
    run("qlmanage", ["-t", "-s", String(WIDTH), "-o", thumbDir, svgPath]);
    if (!existsSync(thumbPng)) {
      throw new Error(`Quick Look did not produce ${thumbPng}`);
    }
    run("ffmpeg", ["-y", "-i", thumbPng, "-vf", `crop=${WIDTH}:${HEIGHT}:0:0`, "-frames:v", "1", "-update", "1", pngPath]);
    pngPaths.push({ pngPath, duration: slide.duration });
  });
  return pngPaths;
}

function buildVideo(pngPaths, outputBase) {
  const segmentDir = path.join(framesDir, "segments");
  mkdirSync(segmentDir, { recursive: true });
  const segmentPaths = pngPaths.map((item, index) => {
    const segmentPath = path.join(segmentDir, `segment-${String(index + 1).padStart(2, "0")}.mp4`);
    run("ffmpeg", [
      "-y",
      "-loop", "1",
      "-framerate", "30",
      "-t", String(item.duration),
      "-i", item.pngPath,
      "-f", "lavfi",
      "-t", String(item.duration),
      "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",
      "-vf", `scale=${WIDTH}:${HEIGHT},format=yuv420p`,
      "-c:v", "libx264",
      "-tune", "stillimage",
      "-r", "30",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      segmentPath
    ], { stdio: "pipe" });
    return segmentPath;
  });

  const concatPath = path.join(outputDir, "segments.concat.txt");
  const concatLines = segmentPaths.map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`);
  writeFileSync(concatPath, `${concatLines.join("\n")}\n`);
  const outputPath = path.join(outputDir, `${outputBase}.mp4`);
  run("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-c", "copy",
    "-movflags", "+faststart",
    outputPath
  ], { stdio: "pipe" });
  return outputPath;
}

function main() {
  const storyboard = JSON.parse(readFileSync(storyboardPath, "utf8"));
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(svgDir, { recursive: true });
  mkdirSync(thumbDir, { recursive: true });
  mkdirSync(pngDir, { recursive: true });
  writeFileSync(path.join(outputDir, ".gitignore"), "*\n!.gitignore\n");

  const pngPaths = renderFrames(storyboard);
  const srtPath = writeSubtitles(storyboard, storyboard.outputBaseName);
  const sourceMapPath = writeSourceMap(storyboard);
  const videoPath = buildVideo(pngPaths, storyboard.outputBaseName);

  console.log(JSON.stringify({
    ok: true,
    video: path.relative(repoRoot, videoPath),
    subtitles: path.relative(repoRoot, srtPath),
    sourceMap: path.relative(repoRoot, sourceMapPath),
    slides: storyboard.slides.length,
    durationSeconds: storyboard.slides.reduce((sum, slide) => sum + slide.duration, 0)
  }, null, 2));
}

main();
