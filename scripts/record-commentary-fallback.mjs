#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
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
  "commentary-fallback-capture",
);
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];
const UNSUPPORTED_FACTS = ["moose", "bear", "dragon", "zombie", "shark"];
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG,
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "ffmpeg",
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
  const explicit = process.env.PLAYWRIGHT_IMPORT_PATH;
  const candidates = [
    explicit,
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
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error("Playwright is not available. Install it or set PLAYWRIGHT_IMPORT_PATH.");
}

function emitAck(socket, event, payload, timeoutMs = 8000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, timeout: true, error: error.message || String(error) });
      else resolve(response || { ok: true });
    });
  });
}

async function connectSocket(baseUrl, events) {
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
  socket.onAny((event, payload) => {
    if (["room.joined", "commentary.pending", "commentary.ready", "commentary.history", "server.info"].includes(event)) {
      events.push({ at: Date.now(), event, payload });
      if (events.length > 500) events.shift();
    }
  });
  return socket;
}

async function joinRoom(socket, room, events) {
  socket.emit("room.join", { id: room });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const joined = events.find((entry) => entry.event === "room.joined" && entry.payload?.id === room);
    if (joined) return { ok: true, joined: joined.payload };
    socket.emit("room.join", { id: room });
    await sleep(500);
  }
  return { ok: false, error: "room.joined timeout" };
}

function commentaryText(payload = {}) {
  return String(payload.commentary || payload.text || payload.script || payload.line || "").trim();
}

function hasProfanity(text) {
  const lower = String(text || "").toLowerCase();
  return PROFANITY_BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function mentionsUnsupportedFact(text) {
  const lower = String(text || "").toLowerCase();
  return UNSUPPORTED_FACTS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function unsupportedFactsForPlayer(summary, players) {
  const lower = String(summary?.text || "").toLowerCase();
  const player = players.find((item) => item.playerId === summary?.player_id);
  if (!player) return ["unknown_player"];
  const eventTypes = new Set(player.events.map((event) => event[0]));
  const hasTrash = eventTypes.has("trash_collected");
  const hasMarine = eventTypes.has("marine_hit");
  const hasPowerup = eventTypes.has("powerup_collected");
  const hasTrail = eventTypes.has("trail_crossed");
  const hasFreeze = eventTypes.has("player_frozen");
  const unsupported = [];
  if (/\bcollect\w*\s+(?:trash\s+and\s+)?(?:marine|turtle|wildlife)\b/.test(lower)) unsupported.push("marine_collection_claim");
  if (/\b(marine|turtle)\b/.test(lower) && !hasMarine) unsupported.push("marine_without_hit");
  if (/\b(trash|pickup|pickups)\b/.test(lower) && !hasTrash) unsupported.push("trash_without_collection");
  if (/\b(powerup|shield|magnet|speed|boost)\b/.test(lower) && !hasPowerup) unsupported.push("powerup_without_collection");
  if (/\b(trail|cross)\b/.test(lower) && !hasTrail && !hasFreeze) unsupported.push("trail_without_crossing");
  if (/\b(freeze|frozen)\b/.test(lower) && !hasFreeze && !hasPowerup) unsupported.push("freeze_without_evidence");
  return unsupported;
}

function summarizeCommentary(payload = {}) {
  const text = commentaryText(payload);
  return {
    source: payload.source || payload.fallback_source || null,
    fallback_source: payload.fallback_source || null,
    player_id: payload.player_id || payload.playerId || payload.summary?.player_id || null,
    player_name: payload.player_name || payload.playerName || payload.summary?.player_name || null,
    session_id: payload.session_id || payload.sessionId || payload.summary?.session_id || null,
    score: payload.score ?? payload.summary?.score ?? null,
    trace_persisted: payload.trace_persisted ?? payload.model_route?.trace_persisted ?? null,
    canvas: payload.canvas ?? null,
    text,
    length: text.length,
  };
}

function playerSpecs(room, suffix) {
  return [
    {
      playerId: `record-trail-freeze-${suffix}`,
      playerName: `Trail Freeze ${suffix}`,
      sessionId: `${room}:trail-freeze`,
      score: 3,
      events: [
        ["game_started", 0, -1.0, 0, 1.0, {}],
        ["trail_crossed", 1, -1.4, 0, 1.6, { related_player_id: `record-shield-recovery-${suffix}` }],
        ["player_frozen", 1, -1.8, 0, 2.0, { cause: "trail_crossed", related_player_id: `record-shield-recovery-${suffix}` }],
        ["powerup_collected", 3, -2.1, 0, 2.4, { powerup_type: "powerup_shield" }],
        ["game_over", 3, -2.5, 0, 3.0, { result: "frozen_recovery" }],
      ],
    },
    {
      playerId: `record-shield-recovery-${suffix}`,
      playerName: `Shield Recovery ${suffix}`,
      sessionId: `${room}:shield-recovery`,
      score: 3,
      events: [
        ["game_started", 0, 0.5, 0, -0.5, {}],
        ["trash_collected", 2, 0.9, 0, -0.9, { item_type: "trash" }],
        ["trail_crossed", 2, 1.4, 0, -1.3, { related_player_id: `record-trail-freeze-${suffix}` }],
        ["powerup_collected", 3, 1.9, 0, -1.7, { powerup_type: "powerup_shield" }],
        ["game_over", 3, 2.3, 0, -2.1, { result: "shield_recovery" }],
      ],
    },
    {
      playerId: `record-turtle-hit-${suffix}`,
      playerName: `Turtle Hit ${suffix}`,
      sessionId: `${room}:turtle-hit`,
      score: -1,
      events: [
        ["game_started", 0, 3.0, 0, 2.0, {}],
        ["marine_hit", -1, 3.4, 0, 2.4, { marine_type: "turtle" }],
        ["trash_collected", 3, 3.9, 0, 2.8, { item_type: "trash" }],
        ["game_over", 3, 4.4, 0, 3.2, { result: "late_recovery" }],
      ],
    },
  ];
}

function eventPayload(room, player, [eventType, score, x, y, z, metadata]) {
  return {
    room_id: room,
    roomId: room,
    session_id: player.sessionId,
    sessionId: player.sessionId,
    player_id: player.playerId,
    playerId: player.playerId,
    player_name: player.playerName,
    playerName: player.playerName,
    type: eventType,
    event_type: eventType,
    score,
    x,
    y,
    z,
    related_player_id: metadata.related_player_id || null,
    item_type: metadata.item_type || metadata.powerup_type || metadata.marine_type || null,
    metadata: { ...metadata, recording_fallback: true },
  };
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message || String(error) }));
  page.on("console", (msg) => {
    if (!["error", "warning"].includes(msg.type())) return;
    const text = msg.text();
    if (text.includes("/api/replay/events") || text.includes("504")) return;
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

async function readAdminFeed(page) {
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent?.trim() || "";
    const sections = Array.from(document.querySelectorAll("#admin-commentary-feed .admin-commentary-player")).map((section) => ({
      text: section.textContent.trim(),
      header: section.querySelector(".admin-commentary-player-header")?.textContent?.trim() || "",
      lines: Array.from(section.querySelectorAll(".admin-commentary-line")).map((line) => line.textContent.trim()),
      meta: Array.from(section.querySelectorAll(".admin-commentary-meta")).map((line) => line.textContent.trim()),
    }));
    return {
      roomLabel: text("admin-room-label"),
      commentaryPlayers: text("admin-ai-commentary-players"),
      commentaryCount: text("admin-ai-commentary-count"),
      commentarySource: text("admin-ai-commentary-source"),
      empty: text("admin-commentary-empty"),
      feedText: text("admin-commentary-feed"),
      sections,
    };
  });
}

async function waitForAdminFeed(page, predicate, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await readAdminFeed(page).catch(() => null);
    if (last && predicate(last)) return { ok: true, elapsedMs: Date.now() - started, state: last };
    await sleep(500);
  }
  return { ok: false, elapsedMs: Date.now() - started, state: last };
}

async function installRecordingChrome(page, room) {
  await page.addStyleTag({
    content: `
      #stwl-recording-banner {
        margin: 0 0 12px;
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 14px 18px;
        border: 1px solid rgba(16, 183, 163, 0.55);
        border-radius: 12px;
        background: rgba(9, 20, 24, 0.86);
        color: #f8f3e7;
        font: 600 18px/1.3 Arial, sans-serif;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.25);
      }
      #stwl-recording-banner strong { color: #10b7a3; }
      #admin-commentary-feed .admin-commentary-player {
        outline: 1px solid rgba(16, 183, 163, 0.35);
        outline-offset: 2px;
      }
    `,
  });
  await page.evaluate((captureRoom) => {
    const prior = document.getElementById("stwl-recording-banner");
    if (prior) prior.remove();
    const banner = document.createElement("div");
    banner.id = "stwl-recording-banner";
    banner.innerHTML = `
      <span><strong>Public OKE</strong> game.event -> Oracle AI Database -> Select AI commentary</span>
      <span>Room ${captureRoom}</span>
    `;
    const anchor = document.getElementById("admin-ai-learning");
    if (anchor?.parentElement) anchor.parentElement.insertBefore(banner, anchor);
    else document.body.prepend(banner);
  }, room);
}

function writeMarkdownReport({ reportPath, baseUrl, room, checks, videoMp4, videoWebm, screenshots, summaries }) {
  const failed = checks.filter((check) => check.status !== "pass");
  const lines = [
    "# Commentary Fallback Capture",
    "",
    `- Base URL: ${baseUrl}`,
    `- Room: ${room}`,
    `- Status: ${failed.length === 0 ? "PASS" : "FAIL"}`,
    `- MP4: ${videoMp4 || "not generated"}`,
    `- WebM: ${videoWebm || "not generated"}`,
    `- Screenshots: ${screenshots.join(", ")}`,
    "",
    "## Commentary Lines",
    "",
    ...summaries.map((summary) => `- ${summary.player_name || summary.player_id}: "${summary.text}" (${summary.source}, ${summary.length} chars)`),
    "",
    "## Checks",
    "",
    ...checks.map((check) => `- ${check.status.toUpperCase()}: ${check.name}`),
    "",
  ];
  return fs.writeFile(reportPath, lines.join("\n"));
}

async function convertVideoToMp4(webmPath, mp4Path) {
  if (!webmPath || !existsSync(webmPath)) return null;
  const ffmpeg = FFMPEG_CANDIDATES.find((candidate) => candidate === "ffmpeg" || existsSync(candidate));
  if (!ffmpeg) return null;
  const result = spawnSync(ffmpeg, [
    "-y",
    "-i", webmPath,
    "-vf", "scale=1600:1000:force_original_aspect_ratio=decrease,pad=1600:1000:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-movflags", "+faststart",
    mp4Path,
  ], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return mp4Path;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "150000"));
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `REC-COMMENTARY-${suffix}`);
  const players = playerSpecs(room, suffix);
  const socketEvents = [];
  const readyEvents = [];
  const pendingEvents = [];
  const emitted = [];
  const checks = [];
  const screenshots = [];
  let browser = null;
  let context = null;
  let page = null;
  let socket = null;
  let videoWebm = null;
  let videoMp4 = null;

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDir, "videos"), { recursive: true });

  try {
    const { chromium } = await import(await resolvePlaywrightImport());
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
    });
    context = await browser.newContext({
      viewport: { width: 1600, height: 1100 },
      deviceScaleFactor: 1,
      recordVideo: {
        dir: path.join(outputDir, "videos"),
        size: { width: 1600, height: 1100 },
      },
    });
    page = await context.newPage();
    const browserErrors = collectBrowserErrors(page);
    const adminUrl = `${baseUrl}/admin/ai-learning?room=${encodeURIComponent(room)}`;
    await page.goto(adminUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForSelector("#admin-ai-learning", { state: "visible", timeout: 30000 });
    await installRecordingChrome(page, room);

    const initialAdmin = await waitForAdminFeed(page, (state) => state.roomLabel.includes(room), 30000);
    const initialShot = path.join(outputDir, "01-admin-waiting.png");
    await page.screenshot({ path: initialShot, fullPage: false });
    screenshots.push(initialShot);
    checks.push({ name: "admin ai-learning page joins requested room", status: initialAdmin.ok ? "pass" : "fail", state: initialAdmin.state });

    await sleep(2500);
    socket = await connectSocket(baseUrl, socketEvents);
    socket.on("commentary.pending", (payload) => pendingEvents.push({ at: Date.now(), payload }));
    socket.on("commentary.ready", (payload) => readyEvents.push({ at: Date.now(), payload }));
    const join = await joinRoom(socket, room, socketEvents);
    checks.push({ name: "recording socket joins room", status: join.ok ? "pass" : "fail", join });

    for (const player of players) {
      socket.emit("player.info.joining", {
        id: player.playerId,
        name: player.playerName,
        room,
        clientSessionId: `${player.playerId}-client`,
        gameplaySessionId: player.sessionId,
      });
      for (const event of player.events) {
        const payload = eventPayload(room, player, event);
        const ack = await emitAck(socket, "game.event", payload, 10000);
        emitted.push({ playerId: player.playerId, eventType: payload.event_type, ack });
        await sleep(320);
      }
    }
    checks.push({
      name: "game.event accepts seeded recording telemetry",
      status: emitted.every((entry) => entry.ack?.ok === true) ? "pass" : "fail",
      emitted,
    });
    checks.push({
      name: "each game_over queues commentary",
      status: players.every((player) => emitted.some((entry) =>
        entry.playerId === player.playerId &&
        entry.eventType === "game_over" &&
        entry.ack?.commentary?.status === "queued"
      )) ? "pass" : "fail",
      emitted: emitted.filter((entry) => entry.eventType === "game_over"),
    });

    const readyStartedAt = Date.now();
    while (Date.now() - readyStartedAt < timeoutMs) {
      const readyPlayerIds = new Set(readyEvents.map((entry) => summarizeCommentary(entry.payload).player_id));
      if (players.every((player) => readyPlayerIds.has(player.playerId))) break;
      await sleep(500);
    }
    const latestByPlayer = new Map();
    for (const entry of readyEvents) {
      const summary = summarizeCommentary(entry.payload);
      if (summary.player_id) latestByPlayer.set(summary.player_id, { at: entry.at, ...summary });
    }
    const summaries = Array.from(latestByPlayer.values());
    checks.push({
      name: "commentary.ready arrives for every recording player",
      status: players.every((player) => latestByPlayer.has(player.playerId)) ? "pass" : "fail",
      elapsedMs: Date.now() - readyStartedAt,
      summaries,
      pending: pendingEvents.map((entry) => summarizeCommentary(entry.payload)),
    });
    const unsafe = summaries
      .map((summary) => ({
        ...summary,
        unsupported: unsupportedFactsForPlayer(summary, players),
      }))
      .filter((summary) =>
        !summary.text ||
        summary.length > 200 ||
        hasProfanity(summary.text) ||
        mentionsUnsupportedFact(summary.text) ||
        summary.unsupported.length > 0
      );
    checks.push({
      name: "commentary lines are bounded, safe, and grounded",
      status: unsafe.length === 0 && summaries.length === players.length ? "pass" : "fail",
      unsafe,
    });
    const deterministic = summaries.filter((summary) =>
      !summary.source ||
      summary.source === "deterministic-fallback" ||
      summary.source === "commentary-pending" ||
      summary.source === "request-summary"
    );
    checks.push({
      name: "commentary source is Select AI or guarded Select AI",
      status: deterministic.length === 0 && summaries.length === players.length ? "pass" : "fail",
      sources: summaries.map((summary) => summary.source),
      rejectedSources: deterministic.map((summary) => ({ player: summary.player_name, source: summary.source, text: summary.text })),
    });

    const feed = await waitForAdminFeed(page, (state) => {
      const text = state.feedText || "";
      return players.every((player) => text.includes(player.playerName));
    }, 90000);
    await page.evaluate(() => {
      document.querySelector(".admin-commentary-panel")?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    await sleep(5500);
    const finalShot = path.join(outputDir, "02-commentary-ready.png");
    await page.screenshot({ path: finalShot, fullPage: false });
    screenshots.push(finalShot);
    checks.push({
      name: "admin commentary feed shows all recording players",
      status: feed.ok ? "pass" : "fail",
      elapsedMs: feed.elapsedMs,
      state: feed.state || await readAdminFeed(page).catch(() => null),
    });
    checks.push({
      name: "admin browser errors",
      status: browserErrors.length === 0 ? "pass" : "fail",
      errors: browserErrors,
    });
  } catch (error) {
    checks.push({ name: "recording fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
  } finally {
    if (socket) socket.disconnect();
    if (page?.video) {
      try {
        videoWebm = await page.video()?.path();
      } catch {}
    }
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  if (videoWebm && existsSync(videoWebm)) {
    const namedWebm = path.join(outputDir, "save-the-wildlife-commentary-fallback.webm");
    await fs.copyFile(videoWebm, namedWebm).catch(() => {});
    videoWebm = namedWebm;
    videoMp4 = await convertVideoToMp4(videoWebm, path.join(outputDir, "save-the-wildlife-commentary-fallback.mp4"));
  }

  const summaries = checks.find((check) => check.name === "commentary.ready arrives for every recording player")?.summaries || [];
  const report = {
    ok: checks.every((check) => check.status === "pass"),
    baseUrl,
    room,
    outputDir,
    videoWebm,
    videoMp4,
    screenshots,
    summaries,
    checks,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outputDir, "recording-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeMarkdownReport({
    reportPath: path.join(outputDir, "recording-report.md"),
    baseUrl,
    room,
    checks,
    videoMp4,
    videoWebm,
    screenshots,
    summaries,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

main();
