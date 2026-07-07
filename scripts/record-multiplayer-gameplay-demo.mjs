#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(
  "event-pack",
  "save-the-wildlife-ai-database-demo",
  "recording",
  "output",
  "multiplayer-gameplay-proof",
);
const DEFAULT_CLIENTS = [
  { name: "Demo Alpha", label: "Alpha", engine: "chrome" },
  { name: "Demo Bravo", label: "Bravo", engine: "chrome" },
  { name: "Demo Charlie", label: "Charlie", engine: "chrome" },
  { name: "Demo Delta", label: "Delta", engine: "chrome" },
];
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "ffmpeg",
].filter(Boolean);
const FFPROBE_CANDIDATES = [
  process.env.FFPROBE,
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe",
  "ffprobe",
].filter(Boolean);

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : fallback;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePlaywrightImport() {
  const candidates = [
    process.env.PLAYWRIGHT_IMPORT_PATH,
    path.join(process.cwd(), "node_modules", "playwright", "index.mjs"),
    path.join(process.cwd(), "node_modules", "playwright", "index.js"),
    path.join(process.cwd(), "web", "node_modules", "playwright", "index.mjs"),
    path.join(process.cwd(), "web", "node_modules", "playwright", "index.js"),
    path.join(
      process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex"),
      "skills",
      "develop-web-game",
      "node_modules",
      "playwright",
      "index.mjs",
    ),
    path.join(
      process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex"),
      "skills",
      "develop-web-game",
      "node_modules",
      "playwright",
      "index.js",
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error("Playwright is not available. Install it or set PLAYWRIGHT_IMPORT_PATH.");
}

function resolveExecutable(candidates, label) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  throw new Error(`${label} not found. Tried: ${candidates.join(", ")}`);
}

function emitAck(socket, event, payload, timeoutMs = 8000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, timeout: true, error: error.message || String(error) });
      else resolve(response || { ok: true });
    });
  });
}

async function connectSocket(baseUrl) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: false,
    timeout: 10000,
  });
  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  return socket;
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message || String(error) }));
  page.on("console", (msg) => {
    if (!["error", "warning"].includes(msg.type())) return;
    const text = msg.text();
    if (text.includes("/api/replay/events") || text.includes("504")) return;
    if (text.includes("Audio load failed; continuing without engine sound")) return;
    if (text.includes("Automatic fallback to software WebGL")) return;
    if (text.includes("GPU stall due to ReadPixels")) return;
    errors.push({ type: msg.type(), text });
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const url = response.url();
    if (url.includes("/api/replay/events")) return;
    errors.push({ type: "http", status: response.status(), url });
  });
  return errors;
}

async function installDemoObserver(page) {
  await page.addInitScript(() => {
    window.__stwlDemoRemoteMotion = { active: false, driverName: "", samples: [] };
    const state = window.__stwlDemoRemoteMotion;
    const sample = (ts) => {
      if (state.active && state.driverName) {
        try {
          const raw = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
          const game = raw ? JSON.parse(raw) : null;
          const remotes = Array.isArray(game?.remotePlayerSamples) ? game.remotePlayerSamples : [];
          const driver = remotes.find((entry) => String(entry?.name || entry?.id || "") === state.driverName);
          state.samples.push({
            ts,
            mode: game?.mode || null,
            found: !!driver,
            x: Number(driver?.x),
            z: Number(driver?.z),
            rotY: Number(driver?.rotY),
            visualX: Number(driver?.visualX),
            visualZ: Number(driver?.visualZ),
            visualRotY: Number(driver?.visualRotY),
            source: driver?.source || null,
            visualSource: driver?.visualSource || null,
          });
          if (state.samples.length > 2200) state.samples.shift();
        } catch (_) {}
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__stwlDemoStartRemoteMotion = (driverName) => {
      state.driverName = String(driverName || "");
      state.samples = [];
      state.active = true;
    };
    window.__stwlDemoStopRemoteMotion = () => {
      state.active = false;
      return { driverName: state.driverName, samples: state.samples || [] };
    };
  });
}

async function readState(page) {
  return page.evaluate(() => {
    const raw = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
    return raw ? JSON.parse(raw) : null;
  });
}

async function waitForState(page, predicate, timeoutMs) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, {
    timeout: Math.max(timeoutMs, 120000),
  });
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    const state = await readState(page).catch(() => null);
    latest = state;
    if (predicate(state)) return { ok: true, elapsedMs: Date.now() - started, state };
    await sleep(250);
  }
  return { ok: false, elapsedMs: Date.now() - started, state: latest };
}

function finiteNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function movementDistance(before, after) {
  if (!before?.player || !after?.player) return 0;
  const dx = Number(after.player.x || 0) - Number(before.player.x || 0);
  const dz = Number(after.player.z || 0) - Number(before.player.z || 0);
  return Number(Math.hypot(dx, dz).toFixed(3));
}

function summarizeHumanRemotes(state, ownName, allNames) {
  const expected = allNames.filter((name) => name !== ownName);
  const samples = Array.isArray(state?.remotePlayerSamples) ? state.remotePlayerSamples : [];
  const visibleNames = samples
    .filter((sample) => sample && sample.isBot !== true)
    .map((sample) => String(sample.name || sample.id || ""));
  return {
    expected,
    visibleNames,
    missing: expected.filter((name) => !visibleNames.includes(name)),
    nonBotRemoteCount: visibleNames.length,
  };
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeRemoteMotion(raw) {
  const samples = Array.isArray(raw?.samples) ? raw.samples : [];
  const usable = samples
    .filter((sample) => sample?.mode === "RUNNING" && sample.found)
    .map((sample) => ({
      ts: finiteNumber(sample.ts),
      x: finiteNumber(Number.isFinite(sample.visualX) ? sample.visualX : sample.x),
      z: finiteNumber(Number.isFinite(sample.visualZ) ? sample.visualZ : sample.z),
    }))
    .filter((sample) => sample.ts != null && sample.x != null && sample.z != null)
    .sort((a, b) => a.ts - b.ts);
  const steps = [];
  for (let i = 1; i < usable.length; i += 1) {
    const previous = usable[i - 1];
    const current = usable[i];
    const dt = current.ts - previous.ts;
    if (dt <= 1 || dt > 200) continue;
    steps.push(Math.hypot(current.x - previous.x, current.z - previous.z));
  }
  const moving = steps.filter((step) => step > 0.001);
  const first = usable[0];
  const last = usable[usable.length - 1];
  const distance = first && last ? Math.hypot(last.x - first.x, last.z - first.z) : 0;
  const p95 = percentile(moving, 95);
  const maxAllowed = Math.max(0.75, p95 * 3);
  return {
    driverName: raw?.driverName || null,
    sampleCount: samples.length,
    usableCount: usable.length,
    movingStepCount: moving.length,
    movementDistance: Number(distance.toFixed(3)),
    maxStep: Number((moving.length ? Math.max(...moving) : 0).toFixed(3)),
    largeJumpCount: moving.filter((step) => step > maxAllowed).length,
  };
}

function safeFileName(value) {
  return String(value || "client").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function openClient({ browser, client, baseUrl, room, outputDir, videosDir, timeoutMs }) {
  const openedAt = Date.now();
  const context = await browser.newContext({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videosDir, size: { width: 960, height: 540 } },
  });
  const page = await context.newPage();
  await installDemoObserver(page);
  const errors = collectBrowserErrors(page);
  const url = `${baseUrl}/?name=${encodeURIComponent(client.name)}&room=${encodeURIComponent(room)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.evaluate(({ label, roomId }) => {
    const existing = document.getElementById("stwl-demo-recording-label");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "stwl-demo-recording-label";
    el.textContent = `${label} | ${roomId} | public OKE`;
    Object.assign(el.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      zIndex: "2147483647",
      padding: "8px 12px",
      borderRadius: "8px",
      background: "rgba(3, 12, 20, 0.74)",
      color: "#ffffff",
      font: "700 18px Arial, sans-serif",
      letterSpacing: "0",
      pointerEvents: "none",
      boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
    });
    document.body.appendChild(el);
  }, { label: client.label, roomId: room }).catch(() => {});
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
  const lobby = await waitForState(page, (state) => state && state.mode !== "RUNNING", 45000);
  await page.screenshot({ path: path.join(outputDir, `${safeFileName(client.label)}-lobby.png`), fullPage: true }).catch(() => {});
  return { ...client, context, page, errors, video: page.video(), url, lobby, openedAt };
}

async function driveClient(client, durationMs, turnKey) {
  await client.page.bringToFront();
  await client.page.click("canvas", { timeout: 5000 }).catch(() => {});
  await client.page.keyboard.down("w");
  if (turnKey) await client.page.keyboard.down(turnKey);
  await sleep(durationMs);
  if (turnKey) await client.page.keyboard.up(turnKey).catch(() => {});
  await client.page.keyboard.up("w").catch(() => {});
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  return result;
}

function buildCompositeVideo({ ffmpeg, videoInputs, outputPath, trimOffsets = [] }) {
  const inputArgs = videoInputs.flatMap((item) => ["-i", item]);
  const trimStart = (idx) => Math.max(0, Number(trimOffsets[idx] || 0));
  const filter = [
    `[0:v]trim=start=${trimStart(0).toFixed(3)},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v0]`,
    `[1:v]trim=start=${trimStart(1).toFixed(3)},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v1]`,
    `[2:v]trim=start=${trimStart(2).toFixed(3)},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v2]`,
    `[3:v]trim=start=${trimStart(3).toFixed(3)},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v3]`,
    "[v0][v1]hstack=inputs=2[top]",
    "[v2][v3]hstack=inputs=2[bottom]",
    "[top][bottom]vstack=inputs=2[v]",
  ].join(";");
  run(ffmpeg, [
    "-y",
    ...inputArgs,
    "-filter_complex", filter,
    "-map", "[v]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

function probeVideo(ffprobe, filePath) {
  const result = run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=index,codec_type,width,height,r_frame_rate,duration",
    "-of", "json",
    filePath,
  ]);
  return JSON.parse(result.stdout || "{}");
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const room = argValue("room", `DEMO-MP-${Date.now().toString().slice(-6)}`);
  const timeoutMs = Number(argValue("timeout-ms", "150000"));
  const alphaDriveMs = Number(argValue("alpha-drive-ms", "6500"));
  const groupDriveMs = Number(argValue("group-drive-ms", "4500"));
  const settleMs = Number(argValue("settle-ms", "2500"));
  const syncMode = argValue("sync-mode", "running");
  const startedAt = new Date().toISOString();
  const videosDir = path.join(outputDir, "videos");
  const rawDir = path.join(outputDir, "raw");
  const checks = [];
  const clients = [];
  let browser = null;
  let adminSocket = null;

  await fs.mkdir(videosDir, { recursive: true });
  await fs.mkdir(rawDir, { recursive: true });
  const playwright = await import(await resolvePlaywrightImport());
  const ffmpeg = resolveExecutable(FFMPEG_CANDIDATES, "ffmpeg");
  const ffprobe = resolveExecutable(FFPROBE_CANDIDATES, "ffprobe");
  const clientSpecs = DEFAULT_CLIENTS;
  const allNames = clientSpecs.map((client) => client.name);

  try {
    browser = await playwright.chromium.launch({ headless: true, channel: "chrome" });
    for (const client of clientSpecs) {
      const opened = await openClient({ browser, client, baseUrl, room, outputDir, videosDir, timeoutMs });
      clients.push(opened);
      checks.push({
        name: `${client.name} waits in lobby`,
        status: opened.lobby.ok ? "pass" : "fail",
        mode: opened.lobby.state?.mode,
      });
      await sleep(350);
    }

    adminSocket = await connectSocket(baseUrl);
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok ? "pass" : "fail", ack: startAck });

    const runningResults = await Promise.all(clients.map(async (client) => {
      const running = await waitForState(client.page, (state) => state?.mode === "RUNNING", timeoutMs);
      const observedAt = Date.now();
      const remaining = Number(running.state?.timeRemaining);
      const elapsedSinceStartMs = Number.isFinite(remaining)
        ? Math.max(0, 60 - Math.max(0, Math.min(60, remaining))) * 1000
        : 0;
      return { client, running, observedAt, runningStartAt: observedAt - elapsedSinceStartMs };
    }));
    for (const { client, running, observedAt, runningStartAt } of runningResults) {
      client.running = running;
      client.runningAt = observedAt;
      client.runningStartAt = runningStartAt;
      checks.push({
        name: `${client.name} reaches RUNNING`,
        status: running.ok ? "pass" : "fail",
        elapsedMs: running.elapsedMs,
        timeRemaining: running.state?.timeRemaining,
      });
      await client.page.screenshot({ path: path.join(outputDir, `${safeFileName(client.label)}-running.png`), fullPage: true }).catch(() => {});
    }

    await sleep(1000);
    const before = {};
    for (const client of clients) before[client.name] = await readState(client.page).catch(() => null);
    for (const client of clients.slice(1)) {
      await client.page.evaluate((driverName) => window.__stwlDemoStartRemoteMotion?.(driverName), clients[0].name).catch(() => {});
    }

    await driveClient(clients[0], alphaDriveMs, "d");
    await Promise.all([
      driveClient(clients[0], groupDriveMs, "a"),
      driveClient(clients[1], groupDriveMs, "a"),
      driveClient(clients[2], groupDriveMs, "d"),
      driveClient(clients[3], groupDriveMs, "d"),
    ]);
    await sleep(settleMs);

    const finalStates = {};
    for (const client of clients) {
      finalStates[client.name] = await readState(client.page).catch(() => null);
      await client.page.screenshot({ path: path.join(outputDir, `${safeFileName(client.label)}-after-drive.png`), fullPage: true }).catch(() => {});
    }

    const driverMove = movementDistance(before[clients[0].name], finalStates[clients[0].name]);
    checks.push({
      name: `${clients[0].name} driver movement is visible`,
      status: driverMove >= 2 ? "pass" : "fail",
      movementDistance: driverMove,
    });

    const remoteProof = [];
    for (const client of clients) {
      const visibility = summarizeHumanRemotes(finalStates[client.name], client.name, allNames);
      checks.push({
        name: `${client.name} sees other human players`,
        status: visibility.missing.length === 0 ? "pass" : "fail",
        ...visibility,
      });
      if (client.name !== clients[0].name) {
        const raw = await client.page.evaluate(() => window.__stwlDemoStopRemoteMotion?.()).catch(() => null);
        const summary = summarizeRemoteMotion(raw);
        remoteProof.push({ observer: client.name, ...summary });
        checks.push({
          name: `${client.name} observes ${clients[0].name} moving remotely`,
          status: summary.movementDistance >= 1.5 && summary.largeJumpCount === 0 ? "pass" : "fail",
          ...summary,
        });
      }
    }

    for (const client of clients) {
      checks.push({
        name: `${client.name} browser console/network errors`,
        status: client.errors.length === 0 ? "pass" : "fail",
        errors: client.errors,
      });
    }

    const rawVideoPaths = [];
    for (const client of clients) {
      const video = client.video;
      await client.context.close();
      const videoPath = await video.path();
      const target = path.join(rawDir, `${safeFileName(client.label)}.webm`);
      await fs.copyFile(videoPath, target);
      rawVideoPaths.push(target);
    }
    await browser.close();
    browser = null;

    const outputVideo = path.join(outputDir, "save-the-wildlife-public-multiplayer-gameplay-proof.mp4");
    const trimOffsets = syncMode === "running"
      ? clients.map((client) => Math.max(0, ((client.runningStartAt || client.runningAt || client.openedAt) - client.openedAt) / 1000))
      : clients.map(() => 0);
    buildCompositeVideo({ ffmpeg, videoInputs: rawVideoPaths, outputPath: outputVideo, trimOffsets });
    const media = probeVideo(ffprobe, outputVideo);
    const framePath = path.join(outputDir, "multiplayer-proof-frame.png");
    run(ffmpeg, ["-y", "-ss", "00:00:22", "-i", outputVideo, "-frames:v", "1", "-update", "1", framePath]);

    const failed = checks.filter((check) => check.status === "fail");
    const result = {
      status: failed.length ? "fail" : "pass",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      clients: clients.map((client, index) => ({
        name: client.name,
        label: client.label,
        url: client.url,
        rawVideo: rawVideoPaths[index],
        openedAt: client.openedAt,
        runningAt: client.runningAt || null,
        runningStartAt: client.runningStartAt || null,
        trimOffsetSeconds: trimOffsets[index],
      })),
      syncMode,
      trimOffsets,
      outputVideo,
      proofFrame: framePath,
      media,
      checks,
      remoteProof,
    };
    await fs.writeFile(path.join(outputDir, "recording-report.json"), `${JSON.stringify(result, null, 2)}\n`);

    const lines = [
      "# Multiplayer Gameplay Proof Recording",
      "",
      `- Status: ${result.status.toUpperCase()}`,
      `- Public URL: ${baseUrl}`,
      `- Room: ${room}`,
      `- Video: ${outputVideo}`,
      `- Proof frame: ${framePath}`,
      `- Sync mode: ${syncMode}`,
      `- Clients: ${clients.map((client) => client.name).join(", ")}`,
      `- Driver movement: ${driverMove} world units`,
      `- Trim offsets: ${trimOffsets.map((value) => value.toFixed(3)).join(", ")} seconds`,
      "",
      "## Checks",
      ...checks.map((check) => `- ${check.status.toUpperCase()}: ${check.name}`),
      "",
      "## Remote Motion Proof",
      ...remoteProof.map((entry) =>
        `- ${entry.observer} saw ${entry.driverName}: movement=${entry.movementDistance}, samples=${entry.usableCount}, largeJumps=${entry.largeJumpCount}`
      ),
    ];
    await fs.writeFile(path.join(outputDir, "recording-report.md"), `${lines.join("\n")}\n`);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (adminSocket) adminSocket.close();
    for (const client of clients) {
      await client.context?.close().catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
