#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-paf-context-matrix-probe");
const DEFAULT_CLIENTS = [
  { name: "QAPafChrome", engine: "chrome", scenario: "desktop" },
  { name: "QAPafWebKit", engine: "webkit", scenario: "desktop" },
  { name: "QAPafChromeMob", engine: "chrome", scenario: "mobile" },
  { name: "QAPafWebKitMob", engine: "webkit", scenario: "mobile" },
];
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function parseClients(value) {
  if (!value) return DEFAULT_CLIENTS;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const [name, engine = idx % 2 ? "webkit" : "chrome", scenario = idx > 1 ? "mobile" : "desktop"] = entry.split(":");
      return { name, engine, scenario };
    });
}

function collectBrowserMessages(page) {
  const errors = [];
  const knownWarnings = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message || String(error) }));
  page.on("console", (msg) => {
    if (!["error", "warning"].includes(msg.type())) return;
    const text = msg.text();
    if (text.includes("/api/replay/events") || text.includes("504")) return;
    if (/Failed to load resource: the server responded with a status of 500/i.test(text)) return;
    if (text.includes("Automatic fallback to software WebGL")) return;
    if (text.includes("GPU stall due to ReadPixels")) return;
    if (text.includes("Audio load failed; continuing without engine sound")) {
      knownWarnings.push({ type: msg.type(), text });
      return;
    }
    errors.push({ type: msg.type(), text });
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const url = response.url();
    if (url.includes("/api/replay/events")) return;
    errors.push({ type: "http", status: response.status(), url });
  });
  return { errors, knownWarnings };
}

async function installPerfObserver(page) {
  await page.addInitScript(() => {
    window.__stwlQaPafContextPerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    const perf = window.__stwlQaPafContextPerf;
    const frame = (ts) => {
      if (perf.lastFrameAt) {
        perf.frameDeltas.push(ts - perf.lastFrameAt);
        if (perf.frameDeltas.length > 3000) perf.frameDeltas.shift();
      }
      perf.lastFrameAt = ts;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          if (perf.longTasks.length > 500) perf.longTasks.shift();
        }
      });
      obs.observe({ type: "longtask", buffered: true });
    } catch (_) {}
  });
}

async function readState(page) {
  return page.evaluate(() => {
    const raw = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
    return raw ? JSON.parse(raw) : null;
  });
}

async function readDom(page) {
  return page.evaluate(() => ({
    bodyClass: document.body.className,
    commentary: document.getElementById("results-commentary")?.textContent?.trim() || "",
    resultsScore: document.getElementById("results-score")?.textContent?.trim() || "",
    compactTime: document.getElementById("compact-time")?.textContent?.trim() || "",
    compactFps: document.getElementById("compact-fps")?.textContent?.trim() || "",
    lobbyStatus: document.getElementById("lobby-status")?.textContent?.trim() || "",
  }));
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaPafContextPerf || {};
    return {
      frameDeltas: perf.frameDeltas || [],
      longTasks: perf.longTasks || [],
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      } : null,
    };
  });
}

async function snapshot(client) {
  const [state, dom] = await Promise.all([
    readState(client.page).catch(() => null),
    readDom(client.page).catch(() => ({})),
  ]);
  return { at: Date.now(), state, dom };
}

async function waitForClient(client, predicate, timeoutMs, intervalMs = 250) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot(client);
    if (predicate(last.state, last.dom)) return { ok: true, elapsedMs: Date.now() - started, ...last };
    await sleep(intervalMs);
  }
  return { ok: false, elapsedMs: Date.now() - started, ...last };
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeNumbers(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return { count: 0 };
  const sum = finite.reduce((acc, value) => acc + value, 0);
  return {
    count: finite.length,
    min: Number(Math.min(...finite).toFixed(2)),
    avg: Number((sum / finite.length).toFixed(2)),
    p95: Number(percentile(finite, 95).toFixed(2)),
    max: Number(Math.max(...finite).toFixed(2)),
  };
}

function commentaryLooksPending(text) {
  return /draft|waiting|pending|commentary is being/i.test(String(text || ""));
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
    status: payload.status || "",
    session_id: payload.session_id || payload.sessionId || payload.summary?.session_id || "",
    player_id: payload.player_id || payload.playerId || payload.summary?.player_id || "",
    player_name: payload.player_name || payload.playerName || payload.summary?.player_name || "",
    score: payload.score ?? payload.summary?.score ?? null,
    source: payload.source || "",
    fallback_source: payload.fallback_source || "",
    route_mode: payload.route_mode || payload.model_route?.route_mode || "",
    trace_persisted: payload.trace_persisted ?? payload.model_route?.trace_persisted ?? null,
    canvas: payload.canvas ?? null,
    in_db_agent: payload.in_db_agent ?? null,
    text,
    length: text.length,
    safe: text.length > 0 && text.length <= 200 && !hasProfanity(text) && !commentaryLooksPending(text),
    raw: payload,
  };
}

function summarizeContext(context = {}) {
  const summary = context.summary || {};
  return {
    ok: context.ok,
    source: context.source,
    warning: context.warning || null,
    session_id: summary.session_id || "",
    room_id: summary.room_id || "",
    player_id: summary.player_id || "",
    player_name: summary.player_name || "",
    score: summary.score ?? null,
    trash_collected: summary.trash_collected ?? null,
    marine_hits: summary.marine_hits ?? null,
    trail_crosses: summary.trail_crosses ?? null,
    freezes: summary.freezes ?? null,
    powerups: summary.powerups || {},
    last_position: summary.last_position || null,
    json_event_types: (context.json_events || []).map((event) => String(event.type || event.event_type || "")),
    graph_fact_types: (context.graph_facts || []).map((fact) => String(fact.type || "")),
    replay_clip_count: Array.isArray(context.replay_clips) ? context.replay_clips.length : 0,
    vector_memory_count: Array.isArray(context.vector_memories) ? context.vector_memories.length : 0,
  };
}

function contextHasMechanic(contextSummary, mechanic) {
  if (mechanic === "trash") return Number(contextSummary.trash_collected || 0) > 0;
  if (mechanic === "marine") return Number(contextSummary.marine_hits || 0) > 0;
  if (mechanic === "freeze") return Number(contextSummary.freezes || 0) > 0 || Number(contextSummary.powerups?.powerup_freeze || 0) > 0;
  if (mechanic === "trail") return Number(contextSummary.trail_crosses || 0) > 0;
  if (mechanic === "powerup") return Object.values(contextSummary.powerups || {}).some((value) => Number(value || 0) > 0);
  return false;
}

function unsupportedCommentaryMentions(text, contextSummary) {
  const lower = String(text || "").toLowerCase();
  const unsupported = [];
  const negatesTrash = /\b(no|zero|0)\s+(trash|clean\s+pickups?|pickups?|items?\s+collected)|no\s+trash\s+collected\b/.test(lower);
  const negatesMarine = /\b(no|zero|0)\s+(marine|turtle)\s+(hits?|contacts?|bumps?)|no\s+(marine|turtle)\s+(hits?|contacts?|bumps?)\b|(hit|hits|hitting)\s+no\s+(marine|turtle)|avoiding\s+(marine|turtle)\s+(hits?|contacts?|bumps?)/.test(lower);
  const negatesPowerup = /\b(no|zero|0)\s+(powerups?|shield|magnet|boost|speed)\b/.test(lower);
  const negatesFreeze = /\b(no|zero|0)\s+(freezes?|frozen|trail\s+freezes?)\b/.test(lower);
  const negatesTrail = /\b(no|zero|0)\s+(trail\s+crossings?|crossings?)\b/.test(lower);
  if (/\btrash|pickup|collected\b/.test(lower) && !contextHasMechanic(contextSummary, "trash") && !negatesTrash) unsupported.push("trash");
  if (/\bturtle|marine|hit|bump\b/.test(lower) && !contextHasMechanic(contextSummary, "marine") && !negatesMarine) unsupported.push("marine");
  if (/\bpowerup|shield|magnet|boost|speed\b/.test(lower) && !contextHasMechanic(contextSummary, "powerup") && !negatesPowerup) unsupported.push("powerup");
  if (/\bfrozen|freeze\b/.test(lower) && !contextHasMechanic(contextSummary, "freeze") && !negatesFreeze) unsupported.push("freeze");
  if (/\btrail|cross\b/.test(lower) && !contextHasMechanic(contextSummary, "trail") && !negatesTrail) unsupported.push("trail");
  return [...new Set(unsupported)];
}

function commentaryMatchesClient(ready, client) {
  const summary = summarizeCommentary(ready);
  if (!summary.session_id || !summary.player_id) return false;
  if (summary.player_name && summary.player_name !== client.name) {
    return summary.player_name.includes(client.name) || client.name.includes(summary.player_name);
  }
  return true;
}

function readyForClient(events, client) {
  const readyEvents = events
    .filter((entry) => entry.event === "commentary.ready")
    .map((entry) => entry.payload || {})
    .map(summarizeCommentary);
  const localPlayerId = client.postGame?.state?.playerId || client.final?.state?.playerId || client.postGame?.state?.player?.id || client.final?.state?.player?.id || "";
  const localSessionId = client.postGame?.state?.gameplaySessionId || client.final?.state?.gameplaySessionId || "";
  const byLocalIdentity = readyEvents.find((entry) => (
    localPlayerId &&
    entry.player_id === localPlayerId &&
    (!localSessionId || entry.session_id === localSessionId)
  ));
  if (byLocalIdentity) return byLocalIdentity;
  return readyEvents.find((entry) => {
    if (entry.player_name && (entry.player_name === client.name || entry.player_name.includes(client.name))) return true;
    if (client.commentary?.dom?.commentary && entry.text === client.commentary.dom.commentary) return true;
    return false;
  }) || null;
}

async function driveClient(client, durationMs) {
  if (client.scenario === "mobile") {
    await sleep(durationMs);
    return;
  }
  await client.page.click("canvas", { timeout: 5000 }).catch(() => {});
  await client.page.keyboard.down("ArrowUp").catch(() => {});
  await client.page.keyboard.down("KeyD").catch(() => {});
  await sleep(Math.min(3000, durationMs));
  await client.page.keyboard.up("KeyD").catch(() => {});
  await client.page.keyboard.down("KeyA").catch(() => {});
  await sleep(Math.max(0, durationMs - 3000));
  await client.page.keyboard.up("KeyA").catch(() => {});
  await client.page.keyboard.up("ArrowUp").catch(() => {});
}

async function openClient({ playwright, clientSpec, baseUrl, room, outputDir, timeoutMs }) {
  const browserType = clientSpec.engine === "chrome" ? playwright.chromium : playwright[clientSpec.engine];
  if (!browserType) throw new Error(`Missing Playwright engine: ${clientSpec.engine}`);
  const browser = await browserType.launch({
    headless: true,
    channel: clientSpec.engine === "chrome" ? "chrome" : undefined,
  });
  const context = await browser.newContext(clientSpec.scenario === "mobile"
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installPerfObserver(page);
  const messages = collectBrowserMessages(page);
  const url = `${baseUrl}/?name=${encodeURIComponent(clientSpec.name)}&room=${encodeURIComponent(room)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
  await page.screenshot({ path: path.join(outputDir, `${clientSpec.name}-initial.png`), fullPage: true }).catch(() => {});
  return { ...clientSpec, browser, context, page, url, ...messages, samples: [] };
}

async function fetchPafEvidence(baseUrl, readySummary, timeoutMs) {
  const payload = {
    session_id: readySummary.session_id,
    player_id: readySummary.player_id,
    max_chars: 200,
  };
  const context = await fetchJson(`${baseUrl}/paf/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, timeoutMs);
  const commentary = await fetchJson(`${baseUrl}/paf/api/commentary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, timeoutMs);
  return { context, commentary };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "180000"));
  const commentaryWaitMs = Number(argValue("commentary-wait-ms", "30000"));
  const pafTimeoutMs = Number(argValue("paf-timeout-ms", "30000"));
  const room = argValue("room", `QA-PAFCTX-${Date.now().toString().slice(-6)}`);
  const clientsSpec = parseClients(argValue("clients", "")).slice(0, 4);
  const checks = [];
  const clients = [];
  const socketEvents = [];
  const startedAt = new Date().toISOString();
  let adminSocket = null;
  let monitorSocket = null;
  let startAck = null;

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const playwright = await import(await resolvePlaywrightImport());
    for (const clientSpec of clientsSpec) {
      clients.push(await openClient({ playwright, clientSpec, baseUrl, room, outputDir, timeoutMs }));
      const lobby = await waitForClient(clients.at(-1), (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
      clients.at(-1).lobby = lobby;
      checks.push({
        name: `${clientSpec.name} waits in lobby before admin start`,
        status: lobby.ok ? "pass" : "fail",
        mode: lobby.state?.mode,
        bodyClass: lobby.dom?.bodyClass,
      });
    }

    monitorSocket = await connectSocket(baseUrl);
    monitorSocket.onAny((event, payload) => {
      if (["commentary.pending", "commentary.ready", "commentary.history", "game.end", "room.joined"].includes(event)) {
        socketEvents.push({ at: Date.now(), event, payload });
        if (socketEvents.length > 300) socketEvents.shift();
      }
    });
    await emitAck(monitorSocket, "room.join", { id: room }, 8000);

    adminSocket = await connectSocket(baseUrl);
    startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const runningResults = await Promise.all(clients.map(async (client) => ({
      client,
      running: await waitForClient(client, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), 45000),
    })));
    for (const { client, running } of runningResults) {
      client.running = running;
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-running.png`), fullPage: true }).catch(() => {});
      checks.push({
        name: `${client.name} reaches running`,
        status: running.ok ? "pass" : "fail",
        elapsedMs: running.elapsedMs,
        timeRemaining: running.state?.timeRemaining,
      });
    }

    await Promise.allSettled(clients.map((client) => driveClient(client, 7000)));

    const postGameResults = await Promise.all(clients.map(async (client) => ({
      client,
      postGame: await waitForClient(client, (state, dom) => dom.bodyClass.includes("phase-post_game") || state?.mode === "ENDED", Math.max(80000, timeoutMs - 45000), 500),
    })));
    for (const { client, postGame } of postGameResults) {
      client.postGame = postGame;
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-postgame-pending.png`), fullPage: true }).catch(() => {});
      checks.push({
        name: `${client.name} reaches post-game`,
        status: postGame.ok ? "pass" : "fail",
        mode: postGame.state?.mode,
        bodyClass: postGame.dom?.bodyClass,
      });
    }

    const commentaryResults = await Promise.all(clients.map(async (client) => ({
      client,
      commentary: await waitForClient(client, (_state, dom) => {
        const text = String(dom.commentary || "").trim();
        return text && !commentaryLooksPending(text);
      }, commentaryWaitMs, 500),
    })));
    for (const { client, commentary } of commentaryResults) {
      client.commentary = commentary;
      client.readySummary = readyForClient(socketEvents, client);
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-commentary-final.png`), fullPage: true }).catch(() => {});
      checks.push({
        name: `${client.name} result card receives final commentary`,
        status: commentary.ok ? "pass" : "fail",
        elapsedMs: commentary.elapsedMs,
        text: commentary.dom?.commentary || "",
      });
      checks.push({
        name: `${client.name} commentary.ready metadata is available`,
        status: client.readySummary?.session_id && client.readySummary?.player_id ? "pass" : "fail",
        ready: client.readySummary,
      });
    }

    for (const client of clients) {
      client.final = await snapshot(client).catch(() => null);
      client.perf = await readPerf(client.page).catch(() => ({}));
      if (!client.readySummary?.session_id || !client.readySummary?.player_id) continue;
      try {
        const evidence = await fetchPafEvidence(baseUrl, client.readySummary, pafTimeoutMs);
        client.pafContext = summarizeContext(evidence.context);
        client.directCommentary = summarizeCommentary(evidence.commentary);
        const eventTypes = new Set(client.pafContext.json_event_types || []);
        const missingCoreEvents = ["game_started", "position_sample", "game_over"].filter((type) => !eventTypes.has(type));
        const directUnsupported = unsupportedCommentaryMentions(client.directCommentary.text, client.pafContext);
        const resultUnsupported = unsupportedCommentaryMentions(client.commentary?.dom?.commentary || "", client.pafContext);
        checks.push({
          name: `${client.name} PAF context contains browser session events`,
          status: client.pafContext.ok === true
            && client.pafContext.source === "oracle-match-intelligence"
            && client.pafContext.session_id === client.readySummary.session_id
            && client.pafContext.player_id === client.readySummary.player_id
            && missingCoreEvents.length === 0
            ? "pass"
            : "fail",
          missingCoreEvents,
          context: client.pafContext,
        });
        checks.push({
          name: `${client.name} direct PAF commentary is bounded and live`,
          status: client.directCommentary.safe
            && client.directCommentary.source
            && client.directCommentary.source !== "deterministic-fallback"
            && client.directCommentary.source !== "request-summary"
            ? "pass"
            : "fail",
          directCommentary: client.directCommentary,
        });
        checks.push({
          name: `${client.name} commentary does not mention unrecorded mechanics`,
          status: directUnsupported.length === 0 && resultUnsupported.length === 0 ? "pass" : "fail",
          directUnsupported,
          resultUnsupported,
          context: client.pafContext,
          resultCommentary: client.commentary?.dom?.commentary || "",
          directCommentary: client.directCommentary,
        });
      } catch (error) {
        checks.push({
          name: `${client.name} PAF context lookup succeeds`,
          status: "fail",
          error: error?.stack || error?.message || String(error),
        });
      }
      const rafMs = summarizeNumbers(client.perf?.frameDeltas || []);
      checks.push({
        name: `${client.name} frame budget remains healthy`,
        status: Number(client.final?.state?.frame?.fps || 0) >= 45 && Number(rafMs.p95 || 0) <= 40 ? "pass" : "fail",
        finalFrame: client.final?.state?.frame || null,
        rafP95: rafMs.p95,
        longTasks: client.perf?.longTasks?.length || 0,
        memory: client.perf?.memory || null,
      });
      checks.push({
        name: `${client.name} browser errors`,
        status: client.errors.length === 0 ? "pass" : "fail",
        errors: client.errors,
        knownWarnings: client.knownWarnings,
      });
    }
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    try { if (monitorSocket) monitorSocket.disconnect(); } catch (_) {}
    for (const client of clients) {
      try { await client.browser.close(); } catch (_) {}
    }
  }

  const result = {
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    clients: clientsSpec,
    startAck,
    checks,
    socketEvents,
    clientSummaries: clients.map((client) => ({
      name: client.name,
      engine: client.engine,
      scenario: client.scenario,
      url: client.url,
      lobby: client.lobby ? { ok: client.lobby.ok, mode: client.lobby.state?.mode, bodyClass: client.lobby.dom?.bodyClass } : null,
      running: client.running ? { ok: client.running.ok, timeRemaining: client.running.state?.timeRemaining, mode: client.running.state?.mode } : null,
      postGame: client.postGame ? { ok: client.postGame.ok, mode: client.postGame.state?.mode, bodyClass: client.postGame.dom?.bodyClass } : null,
      readySummary: client.readySummary || null,
      resultCommentary: client.commentary ? {
        ok: client.commentary.ok,
        elapsedMs: client.commentary.elapsedMs,
        text: client.commentary.dom?.commentary || "",
      } : null,
      pafContext: client.pafContext || null,
      directCommentary: client.directCommentary || null,
      final: client.final || null,
      perf: client.perf ? {
        rafMs: summarizeNumbers(client.perf.frameDeltas || []),
        longTasks: client.perf.longTasks?.length || 0,
        memory: client.perf.memory || null,
      } : null,
      errors: client.errors,
      knownWarnings: client.knownWarnings,
    })),
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Browser PAF Context Matrix Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Clients: ${clientsSpec.map((client) => `\`${client.name}:${client.engine}:${client.scenario}\``).join(", ")}`,
    "",
    "## Checks",
  ];
  for (const check of checks) {
    if (check.context) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; events=${(check.context.json_event_types || []).join(",") || "-"}; score=${check.context.score}`);
    } else if (check.directCommentary) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; source=${check.directCommentary.source}; len=${check.directCommentary.length}`);
    } else if (check.ready) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; session=${check.ready.session_id || "-"}; player=${check.ready.player_id || "-"}`);
    } else if (check.finalFrame) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; fps=${check.finalFrame.fps}; rafP95=${check.rafP95}ms`);
    } else {
      lines.push(`- ${statusIcon(check.status)} ${check.name}`);
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
