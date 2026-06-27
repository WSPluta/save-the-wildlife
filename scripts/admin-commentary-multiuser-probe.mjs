#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "admin-commentary-multiuser-probe");
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];
const UNSUPPORTED_FACTS = ["moose", "bear", "dragon", "zombie", "shark"];

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
    if (["room.joined", "commentary.pending", "commentary.ready", "commentary.history", "server.info"].includes(event)) {
      events.push({ at: Date.now(), event, payload });
      if (events.length > 360) events.shift();
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

function mentionsUnsupportedFact(text) {
  const lower = String(text || "").toLowerCase();
  return UNSUPPORTED_FACTS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function commentaryText(payload = {}) {
  return String(payload.commentary || payload.text || payload.script || payload.line || "").trim();
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

function playerSpecs(room, suffix) {
  return [
    {
      playerId: `qa-caster-alpha-${suffix}`,
      playerName: `QA Caster Alpha ${suffix}`,
      sessionId: `${room}:alpha`,
      score: 12,
      events: [
        ["game_started", 0, 0, 0, 0, {}],
        ["trash_collected", 4, 1.1, 0, -1.2, { item_type: "trash" }],
        ["powerup_collected", 8, 2.0, 0, -1.7, { powerup_type: "powerup_speed" }],
        ["game_over", 12, 2.4, 0, -2.2, { result: "clean_run" }],
      ],
    },
    {
      playerId: `qa-caster-bravo-${suffix}`,
      playerName: `QA Caster Bravo ${suffix}`,
      sessionId: `${room}:bravo`,
      score: -1,
      events: [
        ["game_started", 0, -1.0, 0, 1.0, {}],
        ["marine_hit", -1, -1.8, 0, 1.8, { marine_type: "turtle" }],
        ["player_frozen", -1, -2.0, 0, 2.4, { cause: "trail_crossed", related_player_id: `qa-caster-alpha-${suffix}` }],
        ["game_over", -1, -2.5, 0, 3.0, { result: "turtle_penalty" }],
      ],
    },
    {
      playerId: `qa-caster-charlie-${suffix}`,
      playerName: `QA Caster Charlie ${suffix}`,
      sessionId: `${room}:charlie`,
      score: 6,
      events: [
        ["game_started", 0, 3.0, 0, 2.0, {}],
        ["trail_crossed", 2, 3.4, 0, 2.4, { related_player_id: `qa-caster-bravo-${suffix}` }],
        ["powerup_collected", 4, 4.0, 0, 2.8, { powerup_type: "powerup_shield" }],
        ["trash_collected", 6, 4.4, 0, 3.2, { item_type: "trash" }],
        ["game_over", 6, 4.8, 0, 3.8, { result: "trail_recovery" }],
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
    item_type: metadata.item_type || metadata.powerup_type || null,
    metadata: { ...metadata, qa_probe: "admin-commentary-multiuser" },
  };
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

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "180000"));
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-ACM-${suffix}`);
  const startedAt = new Date().toISOString();
  const players = playerSpecs(room, suffix);
  const socketEvents = [];
  const readyEvents = [];
  const pendingEvents = [];
  const emitted = [];
  const checks = [];
  let socket = null;
  let browser = null;
  let page = null;
  let browserErrors = [];

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const { chromium } = await import(await resolvePlaywrightImport());
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
    });
    page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
    browserErrors = collectBrowserErrors(page);
    await page.goto(`${baseUrl}/admin/ai-learning?room=${encodeURIComponent(room)}`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForSelector("#admin-ai-learning", { state: "visible", timeout: 30000 });
    const initialAdmin = await waitForAdminFeed(page, (state) => state.aiVisible && state.roomLabel.includes(room), 30000);
    await page.screenshot({ path: path.join(outputDir, "admin-initial.png"), fullPage: false }).catch(() => {});
    checks.push({
      name: "admin ai-learning page joins requested room",
      status: initialAdmin.ok ? "pass" : "fail",
      state: initialAdmin.state,
    });

    socket = await connectSocket(baseUrl, socketEvents);
    socket.on("commentary.pending", (payload) => pendingEvents.push({ at: Date.now(), payload }));
    socket.on("commentary.ready", (payload) => readyEvents.push({ at: Date.now(), payload }));
    const join = await joinRoom(socket, room, socketEvents);
    checks.push({ name: "monitor socket joins commentary room", status: join.ok ? "pass" : "fail", join });

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
        await sleep(180);
      }
    }
    checks.push({
      name: "game.event accepts all multi-player telemetry",
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
    const readySummaries = readyEvents.map((entry) => ({ at: entry.at, ...summarizeCommentary(entry.payload) }));
    const latestByPlayer = new Map();
    for (const summary of readySummaries) {
      if (summary.player_id) latestByPlayer.set(summary.player_id, summary);
    }
    checks.push({
      name: "commentary.ready arrives for every seeded player",
      status: players.every((player) => latestByPlayer.has(player.playerId)) ? "pass" : "fail",
      elapsedMs: Date.now() - readyStartedAt,
      readySummaries,
    });
    const unsafe = Array.from(latestByPlayer.values()).filter((summary) =>
      !summary.text ||
      summary.length > 200 ||
      hasProfanity(summary.text) ||
      mentionsUnsupportedFact(summary.text)
    );
    checks.push({
      name: "all commentary lines are bounded, safe, and avoid unsupported facts",
      status: unsafe.length === 0 && latestByPlayer.size === players.length ? "pass" : "fail",
      unsafe,
      readySummaries: Array.from(latestByPlayer.values()),
    });
    const deterministic = Array.from(latestByPlayer.values()).filter((summary) =>
      !summary.source ||
      summary.source === "deterministic-fallback" ||
      summary.source === "commentary-pending"
    );
    checks.push({
      name: "all commentary lines use non-deterministic live source",
      status: deterministic.length === 0 && latestByPlayer.size === players.length ? "pass" : "fail",
      deterministic,
      sources: Array.from(latestByPlayer.values()).map((summary) => summary.source),
    });

    const feed = await waitForAdminFeed(page, (state) => {
      const text = state.feedText || "";
      return players.every((player) => text.includes(player.playerName));
    }, 90000);
    await page.screenshot({ path: path.join(outputDir, "admin-after-multiuser-commentary.png"), fullPage: false }).catch(() => {});
    const finalAdmin = feed.state || await readAdminFeed(page).catch(() => null);
    const summaryPlayerCount = Number(String(finalAdmin?.commentaryPlayers || "").replace(/[^\d.-]/g, ""));
    const summaryLineCount = Number(String(finalAdmin?.commentaryCount || "").replace(/[^\d.-]/g, ""));
    checks.push({
      name: "admin commentary feed groups all seeded players",
      status: feed.ok && summaryPlayerCount >= players.length && finalAdmin.sections.length >= players.length ? "pass" : "fail",
      elapsedMs: feed.elapsedMs,
      summaryPlayerCount,
      summaryLineCount,
      sections: finalAdmin.sections,
    });
    checks.push({
      name: "admin commentary latest source is live source",
      status: finalAdmin?.commentarySource && finalAdmin.commentarySource !== "Waiting" && finalAdmin.commentarySource !== "deterministic-fallback" ? "pass" : "fail",
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
    status: failed.length ? "fail" : "pass",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    players,
    checks,
    emitted,
    pendingEvents: pendingEvents.map((entry) => ({ at: entry.at, ...summarizeCommentary(entry.payload) })),
    readyEvents: readyEvents.map((entry) => ({ at: entry.at, ...summarizeCommentary(entry.payload) })),
    socketEvents,
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Admin Commentary Multiuser Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Players: ${players.map((player) => `\`${player.playerName}\``).join(", ")}`,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
    "",
    "## Commentary",
    ...result.readyEvents.map((entry) => `- ${entry.player_name || entry.player_id}: ${entry.length} chars, source=${entry.source}, text=${JSON.stringify(entry.text)}`),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
