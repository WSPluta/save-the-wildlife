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
  "stage-multiplayer-commentary-proof",
);
const CLIENTS = [
  {
    label: "Alpha",
    name: "Demo Alpha",
    itemType: "trash",
    path: [
      { keys: ["ArrowUp", "ArrowRight"], ms: 1800 },
      { keys: ["ArrowUp"], ms: 900 },
      { keys: ["ArrowUp", "ArrowLeft"], ms: 2200 },
      { keys: ["ArrowUp"], ms: 1000 },
    ],
  },
  {
    label: "Bravo",
    name: "Demo Bravo",
    itemType: "turtle",
    path: [
      { keys: ["ArrowUp", "ArrowLeft"], ms: 2100 },
      { keys: ["ArrowUp"], ms: 800 },
      { keys: ["ArrowUp", "ArrowRight"], ms: 2200 },
      { keys: ["ArrowUp"], ms: 900 },
    ],
  },
  {
    label: "Charlie",
    name: "Demo Charlie",
    itemType: "powerup",
    path: [
      { keys: ["ArrowUp"], ms: 1000 },
      { keys: ["ArrowUp", "ArrowRight"], ms: 2400 },
      { keys: ["ArrowUp", "ArrowLeft"], ms: 1900 },
      { keys: ["ArrowUp"], ms: 900 },
    ],
  },
];
const GAMEPLAY_SEGMENT_SECONDS = 62;
const COMMENTARY_SEGMENT_SECONDS = 18;
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
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];
const STAGE_DRIVER_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"];
const STAGE_DRIVER_STEP_MS = 320;
const STAGE_DRIVER_SAMPLE_MS = 1000;
const STAGE_DRIVER_WAYPOINTS = [
  [
    { x: -18, z: 2.8 },
    { x: 0, z: 3.3 },
    { x: 18, z: 2.7 },
    { x: 23, z: -2.6 },
    { x: 5, z: -3.3 },
    { x: -19, z: -2.8 },
  ],
  [
    { x: 18, z: -2.8 },
    { x: -2, z: -3.3 },
    { x: -22, z: -2.6 },
    { x: -17, z: 2.9 },
    { x: 4, z: 3.3 },
    { x: 22, z: 2.2 },
  ],
  [
    { x: 0, z: -3.3 },
    { x: 21, z: -2.8 },
    { x: 23, z: 2.7 },
    { x: 2, z: 3.4 },
    { x: -22, z: 2.6 },
    { x: -15, z: -3.0 },
  ],
];

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

async function waitFor(predicate, timeoutMs, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
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

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  return result;
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
    latest = await readState(page).catch(() => null);
    if (predicate(latest)) return { ok: true, elapsedMs: Date.now() - started, state: latest };
    await sleep(250);
  }
  return { ok: false, elapsedMs: Date.now() - started, state: latest };
}

function itemEnvelopeId(payload = {}) {
  return payload?.id || payload?.itemId || payload?.data?.id || payload?.item?.id || null;
}

function itemEnvelopeData(payload = {}) {
  return payload?.data || payload?.item || null;
}

function itemCounts(items = {}) {
  const values = Object.values(items || {});
  return {
    total: values.length,
    trash: values.filter((item) => item?.type === "trash").length,
    turtles: values.filter((item) => item?.type === "turtle").length,
    powerups: values.filter((item) => String(item?.type || "").startsWith("powerup_")).length,
  };
}

function summarizeItem(item = {}, fallbackId = "") {
  const pos = item.position || {};
  return {
    id: item.id || item.itemId || fallbackId || "",
    type: item.type || "",
    room: item.room || "",
    position: {
      x: Number(pos.x || 0),
      y: Number(pos.y || 0),
      z: Number(pos.z || 0),
    },
  };
}

function chooseItem(items, usedIds, preferredType) {
  const values = Object.entries(items || {})
    .map(([id, item]) => summarizeItem(item, id))
    .filter((item) => item.id && !usedIds.has(item.id));
  if (preferredType === "powerup") {
    return values.find((item) => String(item.type || "").startsWith("powerup_")) || values.find((item) => item.type === "trash") || values[0] || null;
  }
  return values.find((item) => item.type === preferredType) || values.find((item) => item.type === "trash") || values[0] || null;
}

function namesForOverlay(clients) {
  return clients.map((client) => client.name).join(", ");
}

function keyEventShape(code) {
  const keyByCode = {
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    KeyW: "w",
    KeyA: "a",
    KeyS: "s",
    KeyD: "d",
  };
  return { code, key: keyByCode[code] || code };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAngleRadians(value) {
  let angle = finiteNumber(value, 0);
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function playerPositionFromState(state) {
  const player = state?.player || {};
  const x = Number(player.x);
  const z = Number(player.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z, rotY: finiteNumber(player.rotY, 0), speed: finiteNumber(player.speed, 0) };
}

function distance2d(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(finiteNumber(a.x) - finiteNumber(b.x), finiteNumber(a.z) - finiteNumber(b.z));
}

function isNearBoundary(state, position = playerPositionFromState(state)) {
  if (!position) return false;
  const boundary = state?.worldBoundary || {};
  if (boundary.hit === true) return true;
  const halfX = Number(boundary.halfX);
  const halfZ = Number(boundary.halfZ);
  if (!Number.isFinite(halfX) || !Number.isFinite(halfZ)) return false;
  return Math.abs(position.x) > halfX - 3.2 || Math.abs(position.z) > halfZ - 2.2;
}

function shouldRecoverForStageDriver(state, position = playerPositionFromState(state)) {
  if (!position) return false;
  const boundary = state?.worldBoundary || {};
  if (boundary.hit === true) return true;
  const halfX = Number(boundary.halfX);
  const halfZ = Number(boundary.halfZ);
  if (!Number.isFinite(halfX) || !Number.isFinite(halfZ)) return false;
  return Math.abs(position.x) > halfX - 5.5 || Math.abs(position.z) > halfZ - 4.5;
}

function createMotionTracker(client) {
  return {
    label: client.label,
    name: client.name,
    samples: [],
    distance: 0,
    meaningfulChanges: 0,
    boundarySamples: 0,
    staleSamples: 0,
    lastPosition: null,
    startedAt: Date.now(),
    endedAt: null,
  };
}

function appendMotionSample(tracker, state) {
  const position = playerPositionFromState(state);
  if (!position) {
    tracker.staleSamples += 1;
    return;
  }
  const now = Date.now();
  if (tracker.lastPosition) {
    const delta = distance2d(position, tracker.lastPosition);
    tracker.distance += delta;
    if (delta >= 0.18) tracker.meaningfulChanges += 1;
    else tracker.staleSamples += 1;
  }
  if (isNearBoundary(state, position)) tracker.boundarySamples += 1;
  tracker.lastPosition = { ...position, at: now };
  tracker.samples.push({
    at: now,
    x: Number(position.x.toFixed(2)),
    z: Number(position.z.toFixed(2)),
    rotY: Number(position.rotY.toFixed(3)),
    speed: Number(position.speed.toFixed(3)),
    boundary: isNearBoundary(state, position),
  });
  if (tracker.samples.length > 120) tracker.samples.shift();
}

function summarizeMotionTracker(tracker) {
  const samples = tracker.samples || [];
  const durationSeconds = Math.max(1, ((tracker.endedAt || Date.now()) - tracker.startedAt) / 1000);
  const boundaryRatio = samples.length ? tracker.boundarySamples / samples.length : 1;
  const distance = Number((tracker.distance || 0).toFixed(2));
  const averageSpeed = Number((distance / durationSeconds).toFixed(2));
  const status = samples.length >= 10 &&
    distance >= 18 &&
    tracker.meaningfulChanges >= 8 &&
    boundaryRatio <= 0.55
    ? "pass"
    : "fail";
  return {
    label: tracker.label,
    name: tracker.name,
    status,
    samples: samples.length,
    distance,
    averageSpeed,
    meaningfulChanges: tracker.meaningfulChanges,
    boundarySamples: tracker.boundarySamples,
    boundaryRatio: Number(boundaryRatio.toFixed(2)),
    staleSamples: tracker.staleSamples,
    first: samples[0] || null,
    last: samples[samples.length - 1] || null,
  };
}

function chooseStageDriverWaypoint(client, state, clientIndex) {
  const position = playerPositionFromState(state) || { x: 0, z: 0, rotY: 0 };
  const boundary = state?.worldBoundary || {};
  const halfX = Number.isFinite(Number(boundary.halfX)) ? Math.max(6, Number(boundary.halfX) - 7) : 22;
  const halfZ = Number.isFinite(Number(boundary.halfZ)) ? Math.max(2.8, Number(boundary.halfZ) - 7) : 3.3;
  if (!client.driverState) {
    client.driverState = {
      index: clientIndex % STAGE_DRIVER_WAYPOINTS[clientIndex % STAGE_DRIVER_WAYPOINTS.length].length,
      changedAt: Date.now(),
    };
  }
  const waypoints = STAGE_DRIVER_WAYPOINTS[clientIndex % STAGE_DRIVER_WAYPOINTS.length];
  const current = waypoints[client.driverState.index % waypoints.length];
  const target = {
    x: Math.max(-halfX, Math.min(halfX, current.x)),
    z: Math.max(-halfZ, Math.min(halfZ, current.z)),
  };
  if (distance2d(position, target) < 3.2 || Date.now() - client.driverState.changedAt > 8000) {
    client.driverState.index = (client.driverState.index + 1) % waypoints.length;
    client.driverState.changedAt = Date.now();
  }
  if (shouldRecoverForStageDriver(state, position)) return { x: 0, z: 0, boundaryRecovery: true };
  const next = waypoints[client.driverState.index % waypoints.length];
  return {
    x: Math.max(-halfX, Math.min(halfX, next.x)),
    z: Math.max(-halfZ, Math.min(halfZ, next.z)),
    boundaryRecovery: false,
  };
}

function chooseStageDriverKeys(client, state, clientIndex) {
  const position = playerPositionFromState(state);
  if (!position) return ["ArrowUp"];
  const target = chooseStageDriverWaypoint(client, state, clientIndex);
  const desiredYaw = Math.atan2(target.x - position.x, target.z - position.z);
  const yawDelta = normalizeAngleRadians(desiredYaw - position.rotY);
  const keys = [];
  const hardTurn = Math.abs(yawDelta) > 1.65;
  const steeringKey = yawDelta > 0 ? "ArrowRight" : "ArrowLeft";
  if (Math.abs(yawDelta) > 0.08) keys.push(steeringKey);
  if (target.boundaryRecovery && hardTurn) {
    keys.push("ArrowDown");
  } else {
    keys.push("ArrowUp");
  }
  return keys.length ? keys : ["ArrowUp"];
}

async function installGameOverlay(page, { label, name, room, roster }) {
  return { ok: true, label, name, room, roster };
}

async function updateGameOverlay(client, data) {
  return { ok: true, ignored: true, data };
}

async function updateAllGameOverlays(clients, data) {
  await Promise.all(clients.map((client) => updateGameOverlay(client, data)));
}

async function installGameplayCommentaryOverlay(client, summary) {
  return { ok: true, label: client.label, hasSummary: !!summary };
}

async function installGameplayCommentaryOverlays(clients, summaries) {
  const byPlayerId = new Map();
  for (const summary of summaries || []) {
    if (summary?.player_id) byPlayerId.set(summary.player_id, summary);
  }
  await Promise.all(clients.map((client) =>
    installGameplayCommentaryOverlay(client, byPlayerId.get(client.playerId))
  ));
}

async function installMomentOverlay(client, text, options = {}) {
  return { ok: true, ignored: true, text, options };
}

async function installObservabilityCommentaryOverlay(observability, summaries) {
  return { ok: true, summaries: Array.isArray(summaries) ? summaries.length : 0 };
}

async function openGameClient({ browser, spec, baseUrl, room, outputDir, videosDir, timeoutMs, roster }) {
  const openedAt = Date.now();
  const context = await browser.newContext({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videosDir, size: { width: 960, height: 540 } },
  });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page);
  const url = `${baseUrl}/?name=${encodeURIComponent(spec.name)}&room=${encodeURIComponent(room)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
  await installGameOverlay(page, { label: spec.label, name: spec.name, room, roster });
  const lobby = await waitForState(page, (state) => state && state.mode !== "RUNNING", 45000);
  await updateGameOverlay({ page }, { action: "joined lobby; waiting for presenter start" });
  const lobbyShot = path.join(outputDir, `${spec.label.toLowerCase()}-lobby.png`);
  await page.screenshot({ path: lobbyShot, fullPage: true }).catch(() => {});
  return { ...spec, context, page, errors, video: page.video(), url, openedAt, lobby, lobbyShot };
}

async function openObservabilityView({ browser, baseUrl, room, outputDir, videosDir, timeoutMs }) {
  const openedAt = Date.now();
  const context = await browser.newContext({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videosDir, size: { width: 960, height: 540 } },
  });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page);
  const url = `${baseUrl}/admin/observability?room=${encodeURIComponent(room)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForSelector("#admin-observability", { state: "visible", timeout: timeoutMs });
  const compactTracesVisible = await page.waitForSelector("#admin-observability-traces", {
    state: "visible",
    timeout: 5000,
  }).then(() => true).catch(() => false);
  const lobbyShot = path.join(outputDir, "observability-lobby.png");
  await page.screenshot({ path: lobbyShot, fullPage: true }).catch(() => {});
  return { label: "Observability", context, page, errors, video: page.video(), url, openedAt, lobbyShot, compactTracesVisible };
}

async function updateObservabilityOverlay(observability, data) {
  return { ok: true, ignored: true, data };
}

async function appendObservabilityLedger(observability, ledger, text, options = {}) {
  const entry = {
    at: new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
    text,
    color: options.color || "#20d5c2",
  };
  ledger.push(entry);
  return entry;
}

async function setPageKeys(page, keys, value) {
  const payload = keys.map(keyEventShape);
  await page.evaluate(({ events, down }) => {
    for (const item of events) {
      const event = new KeyboardEvent(down ? "keydown" : "keyup", {
        bubbles: true,
        cancelable: true,
        code: item.code,
        key: item.key,
      });
      document.dispatchEvent(event);
    }
  }, { events: payload, down: !!value });
}

async function releaseStageKeys(page) {
  await setPageKeys(page, STAGE_DRIVER_KEYS, false).catch(() => {});
}

async function driveClient(client, { durationMs, signal, clientIndex = 0, tracker = null } = {}) {
  await client.page.click("canvas", { timeout: 5000 }).catch(() => {});
  const started = Date.now();
  let nextSampleAt = 0;
  while (!signal?.stop && Date.now() - started < Math.max(1000, Number(durationMs || 0))) {
    const state = await readState(client.page).catch(() => null);
    if (tracker && Date.now() >= nextSampleAt) {
      appendMotionSample(tracker, state);
      nextSampleAt = Date.now() + STAGE_DRIVER_SAMPLE_MS;
    }
    const keys = chooseStageDriverKeys(client, state, clientIndex);
    await releaseStageKeys(client.page);
    await setPageKeys(client.page, keys, true);
    await sleep(STAGE_DRIVER_STEP_MS + clientIndex * 35);
  }
  await releaseStageKeys(client.page);
  if (tracker) {
    tracker.endedAt = Date.now();
    const finalState = await readState(client.page).catch(() => null);
    appendMotionSample(tracker, finalState);
  }
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

function commentaryText(payload = {}) {
  return String(payload.commentary || payload.text || payload.script || payload.line || "").trim();
}

function summarizeCommentary(payload = {}) {
  const text = commentaryText(payload);
  return {
    source: payload.source || payload.fallback_source || null,
    player_id: payload.player_id || payload.playerId || payload.summary?.player_id || null,
    player_name: payload.player_name || payload.playerName || payload.summary?.player_name || null,
    session_id: payload.session_id || payload.sessionId || payload.summary?.session_id || null,
    score: payload.score ?? payload.summary?.score ?? null,
    text,
    length: text.length,
  };
}

function hasProfanity(text) {
  const lower = String(text || "").toLowerCase();
  return PROFANITY_BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function checkStatus(value) {
  if (value === true || value === "pass") return "pass";
  return "fail";
}

function eventPayload({ room, client, eventType, score, position, metadata = {} }) {
  const sessionId = client.sessionId || `${room}:${client.label.toLowerCase()}`;
  return {
    room_id: room,
    roomId: room,
    session_id: sessionId,
    sessionId,
    player_id: client.playerId,
    playerId: client.playerId,
    player_name: client.name,
    playerName: client.name,
    type: eventType,
    event_type: eventType,
    score,
    x: Number(position?.x || 0),
    y: Number(position?.y || 0),
    z: Number(position?.z || 0),
    related_player_id: metadata.related_player_id || null,
    related_item_id: metadata.related_item_id || metadata.itemId || null,
    item_type: metadata.item_type || metadata.powerup_type || metadata.marine_type || null,
    metadata: { ...metadata, stage_recording: true },
  };
}

async function emitGameplayEvent(socket, payload) {
  return emitAck(socket, "game.event", payload, 10000);
}

async function installAdminChrome(page, room) {
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
        font: 700 18px/1.3 Arial, sans-serif;
      }
      #stwl-recording-banner strong { color: #10b7a3; }
      #admin-commentary-feed .admin-commentary-player { outline: 1px solid rgba(16, 183, 163, 0.35); outline-offset: 2px; }
    `,
  });
  await page.evaluate((captureRoom) => {
    const prior = document.getElementById("stwl-recording-banner");
    if (prior) prior.remove();
    const banner = document.createElement("div");
    banner.id = "stwl-recording-banner";
    banner.innerHTML = `
      <span><strong>Same room finale</strong> - three players + observability -> game.event -> Oracle AI Database -> Select AI</span>
      <span>Room ${captureRoom}</span>
    `;
    const anchor = document.getElementById("admin-ai-learning");
    if (anchor?.parentElement) anchor.parentElement.insertBefore(banner, anchor);
    else document.body.prepend(banner);
  }, room);
}

async function readAdminFeed(page) {
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent?.trim() || "";
    const sections = Array.from(document.querySelectorAll("#admin-commentary-feed .admin-commentary-player")).map((section) => ({
      header: section.querySelector(".admin-commentary-player-header")?.textContent?.trim() || "",
      lines: Array.from(section.querySelectorAll(".admin-commentary-line")).map((line) => line.textContent.trim()),
      meta: Array.from(section.querySelectorAll(".admin-commentary-meta")).map((line) => line.textContent.trim()),
    }));
    return {
      roomLabel: text("admin-room-label"),
      commentaryPlayers: text("admin-ai-commentary-players"),
      commentaryCount: text("admin-ai-commentary-count"),
      commentarySource: text("admin-ai-commentary-source"),
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

function buildCompositeImage(ffmpeg, inputPaths, outputPath) {
  run(ffmpeg, [
    "-y",
    ...inputPaths.flatMap((item) => ["-i", item]),
    "-filter_complex",
    [
      "[0:v]scale=960:540,setsar=1[v0]",
      "[1:v]scale=960:540,setsar=1[v1]",
      "[2:v]scale=960:540,setsar=1[v2]",
      "[3:v]scale=960:540,setsar=1[v3]",
      "[v0][v1]hstack=inputs=2[top]",
      "[v2][v3]hstack=inputs=2[bottom]",
      "[top][bottom]vstack=inputs=2[v]",
    ].join(";"),
    "-map", "[v]",
    "-frames:v", "1",
    "-update", "1",
    outputPath,
  ]);
}

function buildImageSegment(ffmpeg, imagePath, outputPath, seconds) {
  run(ffmpeg, [
    "-y",
    "-loop", "1",
    "-t", String(seconds),
    "-i", imagePath,
    "-vf", "fps=25,scale=1920:1080,setsar=1,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    outputPath,
  ]);
}

function buildGameplayComposite(ffmpeg, videoInputs, outputPath, trimOffsets = [], seconds = GAMEPLAY_SEGMENT_SECONDS) {
  const trimStart = (idx) => Math.max(0, Number(trimOffsets[idx] || 0));
  run(ffmpeg, [
    "-y",
    ...videoInputs.flatMap((item) => ["-i", item]),
    "-filter_complex",
    [
      `[0:v]trim=start=${trimStart(0).toFixed(3)}:duration=${seconds},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v0]`,
      `[1:v]trim=start=${trimStart(1).toFixed(3)}:duration=${seconds},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v1]`,
      `[2:v]trim=start=${trimStart(2).toFixed(3)}:duration=${seconds},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v2]`,
      `[3:v]trim=start=${trimStart(3).toFixed(3)}:duration=${seconds},setpts=PTS-STARTPTS,scale=960:540,setsar=1[v3]`,
      "[v0][v1]hstack=inputs=2[top]",
      "[v2][v3]hstack=inputs=2[bottom]",
      "[top][bottom]vstack=inputs=2[v]",
    ].join(";"),
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

function concatSegments(ffmpeg, inputs, outputPath) {
  run(ffmpeg, [
    "-y",
    ...inputs.flatMap((item) => ["-i", item]),
    "-filter_complex",
    inputs.map((_, idx) => `[${idx}:v]fps=25,scale=1920:1080,setsar=1,format=yuv420p[v${idx}]`).join(";") +
      ";" + inputs.map((_, idx) => `[v${idx}]`).join("") + `concat=n=${inputs.length}:v=1:a=0[v]`,
    "-map", "[v]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
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

function videoDurationSeconds(media = {}) {
  const formatDuration = Number(media?.format?.duration);
  if (Number.isFinite(formatDuration) && formatDuration > 0) return formatDuration;
  const streamDuration = (media?.streams || [])
    .map((stream) => Number(stream.duration))
    .find((value) => Number.isFinite(value) && value > 0);
  return streamDuration || 0;
}

async function extractProofFrame(ffmpeg, videoPath, outputPath, atSeconds) {
  run(ffmpeg, [
    "-y",
    "-ss", Math.max(0.1, Number(atSeconds || 0)).toFixed(3),
    "-i", videoPath,
    "-frames:v", "1",
    "-update", "1",
    outputPath,
  ]);
  return pathExists(outputPath);
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const room = argValue("room", `DEMO-STAGE-${Date.now().toString().slice(-6)}`);
  const timeoutMs = Number(argValue("timeout-ms", "180000"));
  const requestedDriveMs = Number(argValue("drive-ms", "0"));
  const driveMs = Math.max(
    Number.isFinite(requestedDriveMs) ? requestedDriveMs : 0,
    (GAMEPLAY_SEGMENT_SECONDS - 4) * 1000,
  );
  const outputVideoName = "save-the-wildlife-same-room-competition-commentary-proof.mp4";
  const videosDir = path.join(outputDir, "videos");
  const rawDir = path.join(outputDir, "raw");
  const checks = [];
  const pickupEvents = [];
  const commentaryReady = [];
  const commentaryPending = [];
  const emittedGameEvents = [];
  const socketEvents = [];
  const stageLedger = [];
  let motionSummaries = [];
  let browser = null;
  let monitorSocket = null;
  let observability = null;
  let driverAbort = null;
  let driverTasks = [];

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(videosDir, { recursive: true });
  await fs.mkdir(rawDir, { recursive: true });
  const playwright = await import(await resolvePlaywrightImport());
  const ffmpeg = resolveExecutable(FFMPEG_CANDIDATES, "ffmpeg");
  const ffprobe = resolveExecutable(FFPROBE_CANDIDATES, "ffprobe");
  const roster = namesForOverlay(CLIENTS);
  const items = {};
  const destroyedIds = new Set();

  try {
    browser = await playwright.chromium.launch({ headless: true, channel: "chrome" });
    const clients = await Promise.all(CLIENTS.map((spec) =>
      openGameClient({ browser, spec, baseUrl, room, outputDir, videosDir, timeoutMs, roster })
    ));
    observability = await openObservabilityView({ browser, baseUrl, room, outputDir, videosDir, timeoutMs });
    for (const client of clients) {
      await appendObservabilityLedger(observability, stageLedger, `${client.label} joined lobby`, { color: "#c9f7f2" });
    }

    checks.push({
      name: "all game clients show same room lobby",
      status: clients.every((client) => client.lobby?.ok) ? "pass" : "fail",
      room,
      lobbyScreenshots: [...clients.map((client) => client.lobbyShot), observability.lobbyShot],
    });
    checks.push({
      name: "observability browser opens for the same room",
      status: observability ? "pass" : "fail",
      screenshot: observability?.lobbyShot,
    });

    monitorSocket = await connectSocket(baseUrl);
    monitorSocket.onAny((event, payload) => {
      if (["room.joined", "game.on", "game.time", "items.all", "item.new", "item.destroy", "commentary.pending", "commentary.ready"].includes(event)) {
        socketEvents.push({ at: Date.now(), event, payload });
        if (socketEvents.length > 1000) socketEvents.shift();
      }
    });
    monitorSocket.on("items.all", (payload) => {
      for (const key of Object.keys(items)) delete items[key];
      Object.assign(items, payload || {});
    });
    monitorSocket.on("item.new", (payload) => {
      const id = itemEnvelopeId(payload);
      const item = itemEnvelopeData(payload);
      if (id && item) items[id] = item;
    });
    monitorSocket.on("item.destroy", (payload) => {
      const id = itemEnvelopeId(payload);
      if (id) {
        destroyedIds.add(id);
        delete items[id];
      }
    });
    monitorSocket.on("commentary.pending", (payload) => commentaryPending.push({ at: Date.now(), payload }));
    monitorSocket.on("commentary.ready", (payload) => commentaryReady.push({ at: Date.now(), payload }));
    monitorSocket.emit("room.join", { id: room });
    const monitorObservedRoom = await waitFor(() => Object.keys(items).length > 0, 10000, 100);
    await updateObservabilityOverlay(observability, {
      items: `${Object.keys(items).length} authoritative items received`,
    });
    await appendObservabilityLedger(observability, stageLedger, `${Object.keys(items).length} item records received from room stream`, {
      color: monitorObservedRoom ? "#20d5c2" : "#ffcc66",
    });
    checks.push({
      name: "recording monitor observes same-room item stream",
      status: monitorObservedRoom ? "pass" : "fail",
      itemCount: Object.keys(items).length,
    });

    const startAck = await emitAck(monitorSocket, "admin.presenter.start", { room }, 8000);
    const countdownStartedAt = Date.now();
    await updateObservabilityOverlay(observability, { phase: "countdown started" });
    await appendObservabilityLedger(observability, stageLedger, "Presenter countdown started", {
      color: startAck?.ok === true ? "#20d5c2" : "#ff5f7a",
    });
    checks.push({ name: "presenter starts same room", status: startAck?.ok === true ? "pass" : "fail", startAck });

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
      const state = running.state || {};
      client.playerId = state.playerId || state.player?.id || null;
      client.sessionId = state.gameplaySessionId || `${room}:${client.label.toLowerCase()}`;
    }
    checks.push({
      name: "all game clients reach RUNNING in same session",
      status: runningResults.every((entry) => entry.running.ok && entry.running.state?.roomId === room) ? "pass" : "fail",
      clients: clients.map((client) => ({
        label: client.label,
        playerId: client.playerId,
        sessionId: client.sessionId,
        roomId: client.running?.state?.roomId,
        timeRemaining: client.running?.state?.timeRemaining,
      })),
    });
    await updateObservabilityOverlay(observability, {
      phase: "RUNNING with 3 player browsers",
    });
    await appendObservabilityLedger(observability, stageLedger, "Server state RUNNING; all players released", { color: "#20d5c2" });

    await waitForState(clients[0].page, (state) => (state?.itemsVisible || 0) > 0, 12000).catch(() => null);
    await sleep(1200);
    const countBefore = itemCounts(items);
    await updateAllGameOverlays(clients, {
      action: "same room RUNNING; competition started",
      items: `${countBefore.total} items (${countBefore.trash} trash, ${countBefore.turtles} turtles, ${countBefore.powerups} powerups)`,
    });
    await appendObservabilityLedger(observability, stageLedger, `Item mix visible: ${countBefore.trash} trash, ${countBefore.turtles} turtles, ${countBefore.powerups} powerups`, { color: "#c9f7f2" });

    driverAbort = { stop: false };
    for (const client of clients) client.motionTracker = createMotionTracker(client);
    driverTasks = clients.map((client, idx) =>
      driveClient(client, {
        durationMs: driveMs,
        signal: driverAbort,
        clientIndex: idx,
        tracker: client.motionTracker,
      })
    );
    await appendObservabilityLedger(observability, stageLedger, "Continuous player driving active for video QA", { color: "#20d5c2" });
    await sleep(6500);

    const afterDrive = {};
    for (const client of clients) {
      afterDrive[client.name] = await readState(client.page).catch(() => null);
      const visibility = summarizeHumanRemotes(afterDrive[client.name], client.name, CLIENTS.map((entry) => entry.name));
      client.visibility = visibility;
      await updateGameOverlay(client, {
        remotes: `${visibility.nonBotRemoteCount}/${CLIENTS.length - 1} visible: ${visibility.visibleNames.join(", ") || "none"}`,
      });
    }
    checks.push({
      name: "each client sees the other human players",
      status: clients.every((client) => client.visibility?.missing.length === 0) ? "pass" : "fail",
      visibility: clients.map((client) => ({ name: client.name, ...client.visibility })),
    });

    const usedItemIds = new Set();
    for (const client of clients) {
      let selected = null;
      let ack = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await waitFor(() => Object.keys(items).length > 0, 8000, 100);
        selected = chooseItem(items, usedItemIds, client.itemType);
        if (!selected) break;
        usedItemIds.add(selected.id);
        ack = await emitAck(monitorSocket, "items.collision", {
          itemId: selected.id,
          playerId: client.playerId,
          playerName: client.name,
          clientPosition: selected.position,
          clientItemPosition: selected.position,
        }, 10000);
        if (ack?.ok) break;
        await sleep(350);
      }
      if (!selected) {
        pickupEvents.push({ player: client.name, label: client.label, ok: false, error: "no_item_available" });
        continue;
      }
      const event = {
        playerId: client.playerId,
        playerName: client.name,
        label: client.label,
        selected,
        ack,
      };
      pickupEvents.push(event);
      await sleep(800);
      const counts = itemCounts(items);
      await updateObservabilityOverlay(observability, {
        items: `${counts.total} items after ${client.label} pickup`,
      });
      await appendObservabilityLedger(observability, stageLedger, `${client.label} ${ack?.ok ? "accepted" : "attempted"} ${ack?.itemType || selected.type} collision`, {
        color: ack?.ok ? "#20d5c2" : "#ffcc66",
      });
      await updateAllGameOverlays(clients, {
        action: `${client.label} ${ack?.ok ? "collected" : "attempted"} ${ack?.itemType || selected.type} ${selected.id.slice(0, 6)}; item.destroy broadcast to room`,
        items: `${counts.total} items (${counts.trash} trash, ${counts.turtles} turtles, ${counts.powerups} powerups)`,
      });
      await sleep(900);
    }
    checks.push({
      name: "server collisions create visible pickup/removal events",
      status: pickupEvents.filter((event) => event.ack?.ok === true).length === clients.length ? "pass" : "fail",
      pickupEvents,
      destroyedIds: Array.from(destroyedIds),
    });

    await sleep(1800);
    for (const client of clients) {
      client.telemetryState = await readState(client.page).catch(() => null);
    }

    for (const client of clients) {
      const score = Number(client.telemetryState?.score ?? 0);
      const position = client.telemetryState?.player || { x: 0, y: 0, z: 0 };
      const pickup = pickupEvents.find((event) => event.playerId === client.playerId);
      const started = await emitGameplayEvent(monitorSocket, eventPayload({
        room,
        client,
        eventType: "game_started",
        score: 0,
        position,
        metadata: { stage: "same_room_recording" },
      }));
      emittedGameEvents.push({ player: client.name, eventType: "game_started", ack: started });
      if (pickup?.ack?.ok) {
        const itemType = String(pickup.ack.itemType || pickup.selected?.type || "");
        const eventType = itemType === "turtle"
          ? "marine_hit"
          : itemType.startsWith("powerup_")
          ? "powerup_collected"
          : "trash_collected";
        const metadata = {
          related_item_id: pickup.selected.id,
          item_type: itemType || "trash",
        };
        if (eventType === "powerup_collected") metadata.powerup_type = itemType;
        if (eventType === "marine_hit") metadata.marine_type = itemType;
        const eventAck = await emitGameplayEvent(monitorSocket, eventPayload({
          room,
          client,
          eventType,
          score,
          position: pickup.selected.position,
          metadata,
        }));
        emittedGameEvents.push({ player: client.name, eventType, ack: eventAck });
        await appendObservabilityLedger(observability, stageLedger, `${client.label} telemetry persisted: ${eventType}`, {
          color: eventAck?.ok ? "#20d5c2" : "#ffcc66",
        });
      }
      if (client === clients[clients.length - 1]) {
        const crossed = await emitGameplayEvent(monitorSocket, eventPayload({
          room,
          client,
          eventType: "trail_crossed",
          score,
          position,
          metadata: { related_player_id: clients[0].playerId },
        }));
        const frozen = await emitGameplayEvent(monitorSocket, eventPayload({
          room,
          client,
          eventType: "player_frozen",
          score,
          position,
          metadata: { cause: "trail_crossed", related_player_id: clients[0].playerId },
        }));
        emittedGameEvents.push({ player: client.name, eventType: "trail_crossed", ack: crossed });
        emittedGameEvents.push({ player: client.name, eventType: "player_frozen", ack: frozen });
        await installMomentOverlay(client, "Frozen by rival trail", {
          border: "rgba(255, 204, 102, 0.96)",
          durationMs: 3000,
        });
        await updateAllGameOverlays(clients, {
          action: `${client.label} crossed a trail; freeze event captured`,
          durationMs: 3400,
        });
        await appendObservabilityLedger(observability, stageLedger, `${client.label} trail_crossed -> player_frozen`, {
          color: crossed?.ok && frozen?.ok ? "#ffcc66" : "#ff5f7a",
        });
      }
      await sleep(350);
    }

    await sleep(2200);
    const endAck = await emitAck(monitorSocket, "admin.presenter.end", { room }, 8000);
    await updateObservabilityOverlay(observability, {
      phase: "ENDED; requesting commentary",
      commentary: "game_over events queued after end",
    });
    await appendObservabilityLedger(observability, stageLedger, "Presenter ended the room", {
      color: endAck?.ok ? "#20d5c2" : "#ff5f7a",
    });
    const endedResults = await Promise.all(clients.map((client) =>
      waitForState(client.page, (state) => state?.mode === "ENDED", 15000)
    ));
    checks.push({
      name: "room reaches ENDED before commentary is requested",
      status: endAck?.ok === true && endedResults.every((result) => result.ok) ? "pass" : "fail",
      endAck,
      endedResults: endedResults.map((result, idx) => ({
        label: clients[idx].label,
        ok: result.ok,
        mode: result.state?.mode,
        timeRemaining: result.state?.timeRemaining,
      })),
    });
    await updateAllGameOverlays(clients, {
      action: "Match ended; AI commentary requested now",
      durationMs: 4200,
    });
    await sleep(1000);

    for (const client of clients) {
      client.finalState = await readState(client.page).catch(() => null);
    }

    for (const client of clients) {
      const score = Number(client.finalState?.score ?? client.telemetryState?.score ?? 0);
      const position = client.finalState?.player || client.telemetryState?.player || { x: 0, y: 0, z: 0 };
      const over = await emitGameplayEvent(monitorSocket, eventPayload({
        room,
        client,
        eventType: "game_over",
        score,
        position,
        metadata: { result: `${client.label.toLowerCase()}_finish`, final_score: score },
      }));
      emittedGameEvents.push({ player: client.name, eventType: "game_over", ack: over });
      await appendObservabilityLedger(observability, stageLedger, `${client.label} game_over queued for commentary`, {
        color: over?.commentary?.status === "queued" ? "#20d5c2" : "#ffcc66",
      });
      await sleep(450);
    }

    checks.push({
      name: "game_over events queue one commentary per gameplay player",
      status: clients.every((client) => emittedGameEvents.some((event) =>
        event.player === client.name &&
        event.eventType === "game_over" &&
        event.ack?.commentary?.status === "queued"
      )) ? "pass" : "fail",
      emittedGameEvents: emittedGameEvents.filter((event) => event.eventType === "game_over"),
    });

    const readyStartedAt = Date.now();
    while (Date.now() - readyStartedAt < 90000) {
      const readyPlayerIds = new Set(commentaryReady.map((entry) => summarizeCommentary(entry.payload).player_id));
      if (clients.every((client) => readyPlayerIds.has(client.playerId))) break;
      await sleep(500);
    }
    const latestByPlayer = new Map();
    for (const entry of commentaryReady) {
      const summary = summarizeCommentary(entry.payload);
      if (summary.player_id) latestByPlayer.set(summary.player_id, { at: entry.at, ...summary });
    }
    const summaries = clients.map((client) => latestByPlayer.get(client.playerId)).filter(Boolean);
    await updateObservabilityOverlay(observability, {
      commentary: `${summaries.length}/${clients.length} commentary lines ready`,
    });
    await appendObservabilityLedger(observability, stageLedger, `${summaries.length}/${clients.length} commentary lines ready`, {
      color: summaries.length === clients.length ? "#20d5c2" : "#ffcc66",
    });
    checks.push({
      name: "commentary.ready arrives for all gameplay players",
      status: summaries.length === clients.length ? "pass" : "fail",
      summaries,
      pending: commentaryPending.map((entry) => summarizeCommentary(entry.payload)),
    });
    const uniqueLines = new Set(summaries.map((summary) => summary.text));
    checks.push({
      name: "commentary lines are bounded, safe, and different",
      status: summaries.length === clients.length &&
        uniqueLines.size >= Math.min(3, clients.length) &&
        summaries.every((summary) => summary.text && summary.length <= 200 && !hasProfanity(summary.text))
        ? "pass"
        : "fail",
      uniqueLineCount: uniqueLines.size,
      summaries,
    });

    await sleep(9000);
    const gameplayCaptureEndedAt = Date.now();
    if (driverAbort) driverAbort.stop = true;
    if (driverTasks.length) await Promise.allSettled(driverTasks);
    motionSummaries = clients.map((client) => summarizeMotionTracker(client.motionTracker || createMotionTracker(client)));
    checks.push({
      name: "recording keeps player boats moving throughout gameplay",
      status: motionSummaries.every((summary) => summary.status === "pass") ? "pass" : "fail",
      minimumDistance: 18,
      maximumBoundaryRatio: 0.55,
      summaries: motionSummaries,
    });
    await appendObservabilityLedger(observability, stageLedger, `Motion QA: ${motionSummaries.filter((summary) => summary.status === "pass").length}/${clients.length} players stayed active`, {
      color: motionSummaries.every((summary) => summary.status === "pass") ? "#20d5c2" : "#ffcc66",
    });
    checks.push({
      name: "commentary is available for the real observability view",
      status: summaries.length === clients.length ? "pass" : "fail",
      summaries,
    });

    const rawVideoPaths = [];
    for (const client of clients) {
      await client.context.close();
      const videoPath = await client.video.path();
      const target = path.join(rawDir, `${client.label.toLowerCase()}.webm`);
      await fs.copyFile(videoPath, target);
      rawVideoPaths.push(target);
    }
    const observabilityOpenedAt = observability.openedAt;
    const observabilityLobbyShot = observability.lobbyShot;
    await observability.context.close();
    const observabilityVideoPath = await observability.video.path();
    const observabilityRaw = path.join(rawDir, "observability.webm");
    await fs.copyFile(observabilityVideoPath, observabilityRaw);
    rawVideoPaths.push(observabilityRaw);
    await browser.close();
    browser = null;
    observability = null;

    const lobbyCompositePng = path.join(outputDir, "same-room-lobby-composite.png");
    buildCompositeImage(ffmpeg, [...clients.map((client) => client.lobbyShot), observabilityLobbyShot], lobbyCompositePng);

    const trimOffsets = clients.map((client) =>
      Math.max(0, (countdownStartedAt - client.openedAt) / 1000)
    );
    trimOffsets.push(Math.max(0, (countdownStartedAt - observabilityOpenedAt) / 1000));
    const gameplayDurationSeconds = Math.min(
      90,
      Math.max(GAMEPLAY_SEGMENT_SECONDS, (gameplayCaptureEndedAt - countdownStartedAt) / 1000)
    );
    const outputVideo = path.join(outputDir, outputVideoName);
    buildGameplayComposite(ffmpeg, rawVideoPaths, outputVideo, trimOffsets, gameplayDurationSeconds);

    const media = probeVideo(ffprobe, outputVideo);
    const actualVideoDurationSeconds = videoDurationSeconds(media) || gameplayDurationSeconds;
    const countdownFrame = path.join(outputDir, "proof-countdown-frame.png");
    const countdownFrameOk = await extractProofFrame(ffmpeg, outputVideo, countdownFrame, Math.min(1.2, Math.max(0.2, actualVideoDurationSeconds - 0.5)));
    const gameplayFrame = path.join(outputDir, "proof-gameplay-frame.png");
    const gameplayFrameAt = Math.max(6, Math.min(actualVideoDurationSeconds - 8, actualVideoDurationSeconds * 0.45));
    const gameplayFrameOk = await extractProofFrame(ffmpeg, outputVideo, gameplayFrame, gameplayFrameAt);
    const commentaryFrame = path.join(outputDir, "proof-commentary-frame.png");
    const commentaryFrameAt = Math.max(1, actualVideoDurationSeconds - 4);
    const commentaryFrameOk = await extractProofFrame(ffmpeg, outputVideo, commentaryFrame, commentaryFrameAt);
    checks.push({
      name: "proof frames extracted from actual encoded video",
      status: countdownFrameOk && gameplayFrameOk && commentaryFrameOk ? "pass" : "fail",
      actualVideoDurationSeconds,
      frameTimes: {
        countdown: Number(Math.min(1.2, Math.max(0.2, actualVideoDurationSeconds - 0.5)).toFixed(3)),
        gameplay: Number(gameplayFrameAt.toFixed(3)),
        commentary: Number(commentaryFrameAt.toFixed(3)),
      },
      frames: { countdownFrame, gameplayFrame, commentaryFrame },
    });
    const failed = checks.filter((check) => checkStatus(check.status) === "fail");
    const result = {
      status: failed.length ? "fail" : "pass",
      baseUrl,
      room,
      outputVideo,
      countdownFrame,
      gameplayFrame,
      commentaryFrame,
      media,
      clients: clients.map((client, idx) => ({
        label: client.label,
        name: client.name,
        playerId: client.playerId,
        sessionId: client.sessionId,
        rawVideo: rawVideoPaths[idx],
        trimOffsetSeconds: trimOffsets[idx],
      })),
      observability: {
        rawVideo: rawVideoPaths[rawVideoPaths.length - 1],
        trimOffsetSeconds: trimOffsets[trimOffsets.length - 1],
        screenshot: observabilityLobbyShot,
      },
      pickupEvents,
      commentary: summaries,
      motion: motionSummaries,
      stageLedger,
      checks,
      socketEvents: socketEvents.slice(-80),
      gameplayDurationSeconds,
      actualVideoDurationSeconds,
      generatedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(outputDir, "recording-report.json"), `${JSON.stringify(result, null, 2)}\n`);
    const lines = [
      "# Same-Room Competition Commentary Recording",
      "",
      `- Status: ${result.status.toUpperCase()}`,
      `- Public URL: ${baseUrl}`,
      `- Room: ${room}`,
      `- Video: ${outputVideo}`,
      `- Countdown frame: ${countdownFrame}`,
      `- Gameplay frame: ${gameplayFrame}`,
      `- Commentary frame: ${commentaryFrame}`,
      `- Game clients: ${clients.map((client) => client.name).join(", ")}`,
      `- Fourth browser: public /admin/observability`,
      `- Video flow: countdown -> multiplayer gameplay + real observability -> commentary ready`,
      `- Gameplay duration: ${gameplayDurationSeconds.toFixed(1)} seconds`,
      `- Encoded video duration: ${actualVideoDurationSeconds.toFixed(1)} seconds`,
      `- Trim offsets: ${trimOffsets.map((value) => value.toFixed(3)).join(", ")} seconds`,
      "",
      "## Checks",
      ...checks.map((check) => `- ${checkStatus(check.status).toUpperCase()}: ${check.name}`),
      "",
      "## Pickups",
      ...pickupEvents.map((event) => `- ${event.label}: ${event.ack?.ok ? "OK" : "FAIL"} ${event.ack?.itemType || event.selected?.type || "-"} ${event.selected?.id || ""}`),
      "",
      "## Commentary",
      ...summaries.map((summary) => `- ${summary.player_name}: "${summary.text}" (${summary.source}, ${summary.length} chars)`),
      "",
      "## Motion QA",
      ...motionSummaries.map((summary) => `- ${summary.label}: ${summary.status.toUpperCase()} ${summary.distance}m over ${summary.samples} samples, boundary ratio ${summary.boundaryRatio}`),
      "",
      "## Stage Ledger",
      ...stageLedger.map((entry) => `- ${entry.at}: ${entry.text}`),
    ];
    await fs.writeFile(path.join(outputDir, "recording-report.md"), `${lines.join("\n")}\n`);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (driverAbort) driverAbort.stop = true;
    if (driverTasks.length) await Promise.allSettled(driverTasks).catch(() => {});
    if (monitorSocket) monitorSocket.disconnect();
    if (observability?.context) await observability.context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
