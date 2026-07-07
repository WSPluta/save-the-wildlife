#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "admin-commentary-feed-probe");
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
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

function emitAck(socket, event, payload, timeoutMs = 5000) {
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
    if ([
      "room.joined",
      "game.state",
      "commentary.pending",
      "commentary.ready",
      "commentary.history",
      "server.info",
    ].includes(event)) {
      events.push({ at: Date.now(), event, payload });
      if (events.length > 240) events.shift();
    }
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

function hasProfanity(text) {
  const lower = String(text || "").toLowerCase();
  return PROFANITY_BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function commentaryText(payload = {}) {
  return String(payload.commentary || payload.text || payload.script || payload.line || "").trim();
}

function summarizeCommentary(payload = {}) {
  const text = commentaryText(payload);
  return {
    status: payload.status || null,
    source: payload.source || payload.fallback_source || null,
    fallback_source: payload.fallback_source || null,
    model_id: payload.model_id || payload.modelId || payload.model_route?.primary?.model_id || null,
    runtime_mode: payload.runtime_mode || payload.model_route?.primary?.runtime_mode || null,
    trace_persisted: payload.trace_persisted ?? payload.model_route?.trace_persisted ?? null,
    player_id: payload.player_id || payload.playerId || payload.summary?.player_id || null,
    player_name: payload.player_name || payload.playerName || payload.summary?.player_name || null,
    session_id: payload.session_id || payload.sessionId || payload.summary?.session_id || null,
    score: payload.score ?? payload.summary?.score ?? null,
    text,
    length: text.length,
  };
}

async function waitForAdminFeed(page, predicate, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await readAdminFeed(page).catch(() => null);
    if (last && predicate(last)) {
      return { ok: true, elapsedMs: Date.now() - started, state: last };
    }
    await sleep(500);
  }
  return { ok: false, elapsedMs: Date.now() - started, state: last };
}

async function readAdminFeed(page) {
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent?.trim() || "";
    const visible = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
    };
    const sections = Array.from(document.querySelectorAll("#admin-commentary-feed .admin-commentary-player")).map((section) => ({
      text: section.textContent.trim(),
      header: section.querySelector(".admin-commentary-player-header")?.textContent?.trim() || "",
      lines: Array.from(section.querySelectorAll(".admin-commentary-line")).map((line) => line.textContent.trim()),
      meta: Array.from(section.querySelectorAll(".admin-commentary-meta")).map((line) => line.textContent.trim()),
    }));
    return {
      bodyClass: document.body.className,
      aiVisible: visible("admin-ai-learning"),
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

async function joinPlayer(socket, { room, playerId, playerName, sessionId }, events) {
  const payload = {
    id: playerId,
    name: playerName,
    room,
    clientSessionId: `${playerId}-client`,
    gameplaySessionId: sessionId,
  };
  socket.emit("player.info.joining", payload);
  socket.emit("room.join", { id: room });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const joined = events.find((entry) => entry.event === "room.joined" && entry.payload?.id === room);
    if (joined) return { ok: true, joined: joined.payload };
    socket.emit("player.info.joining", payload);
    socket.emit("room.join", { id: room });
    await sleep(500);
  }
  return { ok: false, error: "room.joined timeout" };
}

function buildTelemetry({ room, sessionId, playerId, playerName }) {
  const base = {
    room_id: room,
    roomId: room,
    session_id: sessionId,
    sessionId,
    player_id: playerId,
    playerId,
    player_name: playerName,
    playerName,
  };
  return [
    {
      ...base,
      type: "game_started",
      event_type: "game_started",
      score: 0,
      x: 0,
      y: 0,
      z: 0,
      metadata: { qa_probe: "admin-commentary-feed", started_by: "qa" },
    },
    {
      ...base,
      type: "trash_collected",
      event_type: "trash_collected",
      score: 3,
      x: 2.25,
      y: 0,
      z: -1.5,
      related_item_id: "qa-trash-admin-feed",
      item_type: "trash",
      metadata: { item_type: "trash", qa_probe: "admin-commentary-feed" },
    },
    {
      ...base,
      type: "powerup_collected",
      event_type: "powerup_collected",
      score: 3,
      x: 3.1,
      y: 0,
      z: -1.9,
      related_item_id: "qa-powerup-freeze-admin-feed",
      item_type: "powerup_freeze",
      metadata: { powerup_type: "powerup_freeze", qa_probe: "admin-commentary-feed" },
    },
    {
      ...base,
      type: "player_frozen",
      event_type: "player_frozen",
      score: 3,
      x: 3.6,
      y: 0,
      z: -2.2,
      related_player_id: "qa-rival-admin-feed",
      metadata: { cause: "trail_crossed", related_player_id: "qa-rival-admin-feed", qa_probe: "admin-commentary-feed" },
    },
    {
      ...base,
      type: "game_over",
      event_type: "game_over",
      score: 9,
      x: 4.2,
      y: 0,
      z: -2.75,
      metadata: { result: "qa_admin_feed", qa_probe: "admin-commentary-feed" },
    },
  ];
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "150000"));
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-ACF-${suffix}`);
  const playerId = argValue("player-id", `qa-admin-feed-player-${suffix}`);
  const playerName = argValue("name", `QA Admin Feed ${suffix}`);
  const sessionId = argValue("session-id", `${room}:${playerId}`);
  const socketEvents = [];
  const checks = [];
  let socket = null;
  let browser = null;
  let page = null;
  let commentaryReady = null;
  let commentaryPending = null;
  let join = null;
  const emitted = [];
  const startedAt = new Date().toISOString();

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const { chromium } = await import(await resolvePlaywrightImport());
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
    const browserErrors = collectBrowserErrors(page);
    const adminUrl = `${baseUrl}/admin/ai-learning?room=${encodeURIComponent(room)}`;
    await page.goto(adminUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForSelector("#admin-ai-learning", { state: "visible", timeout: 30000 });
    const initialAdmin = await waitForAdminFeed(page, (state) => state.aiVisible && state.roomLabel.includes(room), 30000);
    await page.screenshot({ path: path.join(outputDir, "admin-initial.png"), fullPage: false }).catch(() => {});
    checks.push({
      name: "admin ai-learning page joins requested room",
      status: initialAdmin.ok ? "pass" : "fail",
      room,
      state: initialAdmin.state,
    });

    socket = await connectSocket(baseUrl, socketEvents);
    socket.on("commentary.pending", (payload) => { commentaryPending = payload || {}; });
    socket.on("commentary.ready", (payload) => { commentaryReady = payload || {}; });
    checks.push({ name: "player socket connects", status: "pass" });

    join = await joinPlayer(socket, { room, playerId, playerName, sessionId }, socketEvents);
    checks.push({ name: "player socket joins commentary room", status: join.ok ? "pass" : "fail", join });

    for (const event of buildTelemetry({ room, sessionId, playerId, playerName })) {
      const ack = await emitAck(socket, "game.event", event, 8000);
      emitted.push({ type: event.type, ack });
      await sleep(150);
    }
    const failedAcks = emitted.filter((entry) => entry.ack?.ok !== true);
    checks.push({
      name: "game.event accepts seeded telemetry and queues commentary",
      status: failedAcks.length === 0 && emitted.some((entry) => entry.type === "game_over" && entry.ack?.commentary?.status === "queued") ? "pass" : "fail",
      emitted,
    });

    const readyStartedAt = Date.now();
    while (!commentaryReady && Date.now() - readyStartedAt < timeoutMs) {
      await sleep(500);
    }
    const readySummary = summarizeCommentary(commentaryReady || {});
    checks.push({
      name: "commentary.ready arrives for seeded player",
      status: commentaryReady && readySummary.player_id === playerId && readySummary.session_id === sessionId ? "pass" : "fail",
      elapsedMs: Date.now() - readyStartedAt,
      commentaryReady: readySummary,
      commentaryPending: summarizeCommentary(commentaryPending || {}),
    });
    checks.push({
      name: "commentary line is bounded and safe",
      status: readySummary.text
        && readySummary.length <= 200
        && !hasProfanity(readySummary.text)
        ? "pass"
        : "fail",
      commentaryReady: readySummary,
    });
    checks.push({
      name: "commentary route is not deterministic fallback",
      status: readySummary.source
        && readySummary.source !== "deterministic-fallback"
        && readySummary.source !== "commentary-pending"
        ? "pass"
        : "fail",
      commentaryReady: readySummary,
    });

    const feed = await waitForAdminFeed(page, (state) => {
      const text = state.feedText || "";
      return text.includes(playerName) || state.sections.some((section) =>
        section.header.includes(playerName) ||
        section.lines.some((line) => readySummary.text && line.includes(readySummary.text.slice(0, Math.min(40, readySummary.text.length))))
      );
    }, 90000);
    await page.screenshot({ path: path.join(outputDir, "admin-after-commentary.png"), fullPage: false }).catch(() => {});
    const finalAdmin = feed.state || await readAdminFeed(page).catch(() => null);
    checks.push({
      name: "admin commentary feed shows seeded player line",
      status: feed.ok ? "pass" : "fail",
      elapsedMs: feed.elapsedMs,
      state: finalAdmin,
    });
    const count = Number(String(finalAdmin?.commentaryCount || "").replace(/[^\d.-]/g, ""));
    checks.push({
      name: "admin commentary summary increments",
      status: Number.isFinite(count) && count > 0 && finalAdmin?.sections?.length > 0 ? "pass" : "fail",
      count,
      sections: finalAdmin?.sections?.length || 0,
      source: finalAdmin?.commentarySource,
    });
    checks.push({
      name: "admin browser errors",
      status: browserErrors.length === 0 ? "pass" : "fail",
      errors: browserErrors,
    });
  } catch (error) {
    checks.push({
      name: "probe fatal error",
      status: "fail",
      error: error?.stack || error?.message || String(error),
    });
  } finally {
    try { if (socket) socket.disconnect(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
  }

  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length === 0 ? "pass" : "fail",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    playerId,
    playerName,
    sessionId,
    checks,
    emitted,
    commentaryPending: summarizeCommentary(commentaryPending || {}),
    commentaryReady: summarizeCommentary(commentaryReady || {}),
    socketEvents,
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Admin Commentary Feed Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Player: \`${playerName}\``,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
