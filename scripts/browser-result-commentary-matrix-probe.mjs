#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-result-commentary-matrix-probe");
const DEFAULT_CLIENTS = [
  { name: "QAComChrome", engine: "chrome", scenario: "desktop" },
  { name: "QAComWebKit", engine: "webkit", scenario: "desktop" },
  { name: "QAComChromeMob", engine: "chrome", scenario: "mobile" },
  { name: "QAComWebKitMob", engine: "webkit", scenario: "mobile" },
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
    window.__stwlQaResultCommentaryPerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    const perf = window.__stwlQaResultCommentaryPerf;
    const frame = (ts) => {
      if (perf.lastFrameAt) {
        perf.frameDeltas.push(ts - perf.lastFrameAt);
        if (perf.frameDeltas.length > 2500) perf.frameDeltas.shift();
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
    const perf = window.__stwlQaResultCommentaryPerf || {};
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

function summarizeCommentaryPayload(payload = {}) {
  const text = commentaryText(payload);
  return {
    player_id: payload.player_id || payload.playerId || null,
    player_name: payload.player_name || payload.playerName || payload.name || null,
    session_id: payload.session_id || payload.sessionId || null,
    status: payload.status || null,
    source: payload.source || payload.fallback_source || null,
    llm_generated: payload.llm_generated === true || payload.llm_generated === 1,
    select_ai_verified: payload.select_ai_verified === true,
    generation_mode: payload.generation_mode || null,
    generation_proof: payload.generation_proof || null,
    fallback_source: payload.fallback_source || null,
    model_id: payload.model_id || payload.modelId || payload.model_route?.primary?.model_id || null,
    runtime_mode: payload.runtime_mode || payload.model_route?.primary?.runtime_mode || null,
    trace_persisted: payload.trace_persisted ?? payload.model_route?.trace_persisted ?? null,
    score: payload.score ?? payload.summary?.score ?? null,
    text,
    length: text.length,
    safe: text.length > 0 && text.length <= 200 && !hasProfanity(text) && !commentaryLooksPending(text),
  };
}

function commentaryMatchesClient(ready, client) {
  if (!ready) return false;
  const playerName = String(ready.player_name || ready.playerName || ready.name || "");
  const text = commentaryText(ready);
  return text && (!playerName || playerName === client.name);
}

async function openClient({ playwright, clientSpec, baseUrl, room, timeoutMs }) {
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
  return { ...clientSpec, browser, context, page, url, ...messages, commentaryEvents: [], samples: [] };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "165000"));
  const commentaryWaitMs = Number(argValue("commentary-wait-ms", "30000"));
  const room = argValue("room", `QA-RCOM-${Date.now().toString().slice(-6)}`);
  const clientsSpec = parseClients(argValue("clients", ""));
  const checks = [];
  const clients = [];
  const socketEvents = [];
  let monitorSocket = null;
  let adminSocket = null;
  let startAck = null;

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const playwright = await import(await resolvePlaywrightImport());
    monitorSocket = await connectSocket(baseUrl);
    monitorSocket.onAny((event, payload) => {
      if (["room.joined", "commentary.pending", "commentary.ready", "commentary.history", "game.end"].includes(event)) {
        socketEvents.push({ at: Date.now(), event, payload });
        if (socketEvents.length > 500) socketEvents.shift();
      }
    });
    const monitorJoin = await emitAck(monitorSocket, "room.join", { id: room }, 5000);
    checks.push({
      name: "monitor joins commentary room",
      status: monitorJoin?.ok === true ? "pass" : "warn",
      monitorJoin,
    });

    for (const clientSpec of clientsSpec) {
      const client = await openClient({ playwright, clientSpec, baseUrl, room, timeoutMs });
      clients.push(client);
      const lobby = await waitForClient(client, (state, dom) => state && dom.bodyClass?.includes("phase-lobby"), 45000);
      client.lobby = lobby;
      checks.push({ name: `${client.name} waits in lobby`, status: lobby.ok ? "pass" : "fail", mode: lobby.state?.mode });
    }

    adminSocket = await connectSocket(baseUrl);
    startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", startAck });

    const runningResults = await Promise.all(clients.map(async (client) => ({
      client,
      running: await waitForClient(client, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass?.includes("phase-gameplay"), 45000),
    })));
    for (const { client, running } of runningResults) {
      client.running = running;
      checks.push({
        name: `${client.name} reaches running`,
        status: running.ok && Number(running.state?.timeRemaining) >= 55 ? "pass" : "fail",
        timeRemaining: running.state?.timeRemaining,
      });
    }

    const postGameResults = await Promise.all(clients.map(async (client) => ({
      client,
      postGame: await waitForClient(client, (state, dom) => (
        state?.mode === "ENDED" || dom.bodyClass?.includes("phase-post_game")
      ), Math.min(timeoutMs, 95000), 1000),
    })));
    for (const { client, postGame } of postGameResults) {
      client.postGame = postGame;
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-postgame-pending.png`), fullPage: true }).catch(() => {});
      checks.push({
        name: `${client.name} reaches result surface`,
        status: postGame.ok ? "pass" : "fail",
        mode: postGame.state?.mode,
        bodyClass: postGame.dom?.bodyClass,
        commentary: postGame.dom?.commentary,
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
      client.final = await snapshot(client).catch(() => null);
      client.perf = await readPerf(client.page).catch(() => ({}));
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-commentary-final.png`), fullPage: true }).catch(() => {});
      const text = String(commentary.dom?.commentary || "").trim();
      const readyForClient = socketEvents
        .filter((entry) => entry.event === "commentary.ready")
        .map((entry) => entry.payload || {})
        .find((payload) => commentaryMatchesClient(payload, client));
      const readySummary = summarizeCommentaryPayload(readyForClient || {});
      client.readySummary = readySummary;
      const source = String(readySummary.source || "");
      const uiScoreMatch = String(client.final?.dom?.resultsScore || commentary.dom?.resultsScore || "").match(/-?\d+(?:\.\d+)?/);
      const uiScore = uiScoreMatch ? Number(uiScoreMatch[0]) : NaN;
      const stateScore = Number(client.final?.state?.score);
      const readyScore = Number(readySummary.score);
      const exactScorePattern = Number.isFinite(readyScore)
        ? new RegExp(`(^|[^\\d-])${String(readyScore).replace(".", "\\.")}(?=$|[^\\d])`)
        : null;
      const raf = summarizeNumbers(client.perf?.frameDeltas || []);
      checks.push({
        name: `${client.name} result card receives final commentary`,
        status: commentary.ok ? "pass" : "fail",
        elapsedMs: commentary.elapsedMs,
        text,
      });
      checks.push({
        name: `${client.name} result commentary is bounded and safe`,
        status: text && text.length <= 200 && !hasProfanity(text) && !commentaryLooksPending(text) ? "pass" : "fail",
        length: text.length,
        text,
      });
      checks.push({
        name: `${client.name} commentary.ready is unmodified Select AI output`,
        status: readySummary.text
          && source === "select-ai"
          && readySummary.llm_generated === true
          && readySummary.select_ai_verified === true
          && readySummary.generation_proof?.select_ai_verified === true
          && readySummary.generation_proof?.operation === "DBMS_CLOUD_AI.GENERATE:chat"
          && Number.isFinite(Number(readySummary.generation_proof?.latency_ms))
          && readySummary.generation_proof?.output_rewritten === false
          ? "pass"
          : "fail",
        readySummary,
      });
      checks.push({
        name: `${client.name} UI, game state, event, and commentary share the final score`,
        status: Number.isFinite(uiScore)
          && Number.isFinite(stateScore)
          && Number.isFinite(readyScore)
          && uiScore === stateScore
          && stateScore === readyScore
          && exactScorePattern?.test(text)
          ? "pass"
          : "fail",
        uiScore,
        stateScore,
        readyScore,
        commentary: text,
      });
      checks.push({
        name: `${client.name} frame budget remains healthy`,
        status: Number(client.final?.state?.frame?.fps || 0) >= 45 && Number(raf.p95 || 0) <= 45 ? "pass" : "fail",
        frame: client.final?.state?.frame || null,
        rafP95: raf.p95,
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
    status: checks.every((check) => check.status === "pass" || check.status === "warn") ? "pass" : "fail",
    startedAt: new Date().toISOString(),
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
      running: client.running ? { ok: client.running.ok, timeRemaining: client.running.state?.timeRemaining } : null,
      postGame: client.postGame ? {
        ok: client.postGame.ok,
        mode: client.postGame.state?.mode,
        bodyClass: client.postGame.dom?.bodyClass,
        commentary: client.postGame.dom?.commentary,
      } : null,
      commentary: client.commentary ? {
        ok: client.commentary.ok,
        elapsedMs: client.commentary.elapsedMs,
        text: client.commentary.dom?.commentary || "",
      } : null,
      readySummary: client.readySummary || null,
      final: client.final || null,
      errors: client.errors,
      knownWarnings: client.knownWarnings,
    })),
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Browser Result Commentary Matrix Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Clients: ${clientsSpec.map((client) => `\`${client.name}:${client.engine}:${client.scenario}\``).join(", ")}`,
    "",
    "## Checks",
    ...checks.map((check) => {
      const text = check.text ? `; text=${JSON.stringify(String(check.text).slice(0, 120))}` : "";
      const elapsed = check.elapsedMs != null ? `; elapsed=${check.elapsedMs}ms` : "";
      return `- ${statusIcon(check.status)} ${check.name}${elapsed}${text}`;
    }),
    "",
    "## Commentary",
    ...clients.map((client) => {
      const text = String(client.commentary?.dom?.commentary || "").trim();
      const source = client.readySummary?.source || "missing";
      return `- ${client.name}: source=${source}; length=${text.length}; text=${JSON.stringify(text)}`;
    }),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
