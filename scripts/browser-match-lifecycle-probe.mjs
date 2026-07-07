#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-match-lifecycle-probe");
const DEFAULT_CLIENTS = [
  { name: "QALifeChrome", engine: "chrome", scenario: "desktop" },
  { name: "QALifeWebKit", engine: "webkit", scenario: "desktop" },
  { name: "QALifeMobile", engine: "chrome", scenario: "mobile" },
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
    window.__stwlQaLifecyclePerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    const perf = window.__stwlQaLifecyclePerf;
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
    lobbyStatus: document.getElementById("lobby-status")?.textContent?.trim() || "",
    compactTime: document.getElementById("compact-time")?.textContent?.trim() || "",
    hudTime: document.getElementById("hud-time")?.textContent?.trim() || "",
    resultsScore: document.getElementById("results-score")?.textContent?.trim() || "",
    commentary: document.getElementById("results-commentary")?.textContent?.trim() || "",
  }));
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaLifecyclePerf || {};
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

function parseClients(value) {
  if (!value) return DEFAULT_CLIENTS;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const [name, engine = idx === 1 ? "webkit" : "chrome", scenario = idx === 2 ? "mobile" : "desktop"] = entry.split(":");
      return { name, engine, scenario };
    });
}

function timerSummary(samples) {
  const values = samples
    .map((entry) => Number(entry.state?.timeRemaining))
    .filter(Number.isFinite);
  const jumps = [];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] - values[i] > 3) jumps.push({ idx: i, previous: values[i - 1], current: values[i], delta: values[i - 1] - values[i] });
  }
  return {
    count: values.length,
    first: values.length ? values[0] : null,
    last: values.length ? values[values.length - 1] : null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    jumps,
  };
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

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "150000"));
  const room = argValue("room", `QA-LIFE-${Date.now().toString().slice(-6)}`);
  const clientsSpec = parseClients(argValue("clients", "")).slice(0, 4);
  const startedAt = new Date().toISOString();
  const checks = [];
  const clients = [];
  const socketEvents = [];
  let adminSocket = null;
  let startAck = null;
  let endAck = null;

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

    adminSocket = await connectSocket(baseUrl);
    adminSocket.onAny((event, payload) => {
      if (["game.state", "startingGame", "game.on", "game.time", "game.end", "room.joined"].includes(event)) {
        socketEvents.push({ at: Date.now(), event, payload });
        if (socketEvents.length > 220) socketEvents.shift();
      }
    });
    startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const runningResults = await Promise.all(clients.map(async (client) => ({
      client,
      running: await waitForClient(client, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), 45000),
    })));
    for (const { client, running } of runningResults) {
      client.running = running;
      client.runningAt = running.ok ? running.at : null;
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-running.png`), fullPage: true }).catch(() => {});
      const initialRemaining = Number(running.state?.timeRemaining);
      checks.push({
        name: `${client.name} reaches running near 60s`,
        status: running.ok && initialRemaining >= 55 && initialRemaining <= 60 ? "pass" : "fail",
        elapsedMs: running.elapsedMs,
        initialRemaining,
        mode: running.state?.mode,
        bodyClass: running.dom?.bodyClass,
      });
    }

    const observeStartedAt = Date.now();
    const deadline = observeStartedAt + Math.min(timeoutMs, 95000);
    while (Date.now() < deadline) {
      for (const client of clients) {
        const sample = await snapshot(client).catch(() => null);
        if (sample) {
          client.samples.push(sample);
          if (!client.postGameAt && (sample.dom?.bodyClass || "").includes("phase-post_game")) client.postGameAt = sample.at;
          if (!client.endedAt && sample.state?.mode === "ENDED") client.endedAt = sample.at;
        }
      }
      if (clients.every((client) => client.postGameAt || client.endedAt)) break;
      await sleep(1000);
    }

    for (const client of clients) {
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-postgame.png`), fullPage: true }).catch(() => {});
      client.final = await snapshot(client).catch(() => null);
      client.perf = await readPerf(client.page).catch(() => ({}));
      const endAt = client.postGameAt || client.endedAt || null;
      const runningAt = client.running?.at || client.runningAt || null;
      const durationMs = endAt && runningAt ? endAt - runningAt : null;
      const finalRemaining = Number(client.final?.state?.timeRemaining);
      const summary = timerSummary(client.samples);
      client.durationMs = durationMs;
      checks.push({
        name: `${client.name} reaches post-game near one-minute duration`,
        status: durationMs != null && durationMs >= 52000 && durationMs <= 75000 ? "pass" : "fail",
        durationMs,
        postGameAt: client.postGameAt || null,
        endedAt: client.endedAt || null,
        finalMode: client.final?.state?.mode,
        finalBodyClass: client.final?.dom?.bodyClass,
        finalRemaining: Number.isFinite(finalRemaining) ? finalRemaining : null,
        timerSummary: summary,
      });
      checks.push({
        name: `${client.name} timer reaches zero before result surface`,
        status: Number.isFinite(finalRemaining) && finalRemaining <= 1 ? "pass" : "fail",
        finalRemaining: Number.isFinite(finalRemaining) ? finalRemaining : null,
        finalMode: client.final?.state?.mode,
        finalBodyClass: client.final?.dom?.bodyClass,
      });
      const rafMs = summarizeNumbers(client.perf?.frameDeltas || []);
      checks.push({
        name: `${client.name} frame budget remains healthy through match`,
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

    const endTimes = clients
      .map((client) => client.postGameAt || client.endedAt)
      .filter(Number.isFinite);
    const endSpreadMs = endTimes.length ? Math.max(...endTimes) - Math.min(...endTimes) : null;
    checks.push({
      name: "browser clients reach results together",
      status: endSpreadMs != null && endSpreadMs <= 4000 && endTimes.length === clients.length ? "pass" : "fail",
      endSpreadMs,
      endTimesByClient: clients.map((client) => ({ name: client.name, endAt: client.postGameAt || client.endedAt || null, durationMs: client.durationMs || null })),
    });

    endAck = await emitAck(adminSocket, "admin.presenter.end", { room }, 8000);
    const alreadyEnded = endAck?.ok === false && endAck?.error === "invalid_state" && endAck?.state === "ENDED";
    checks.push({
      name: "admin presenter end accepted or room already naturally ended",
      status: endAck?.ok === true || alreadyEnded ? "pass" : "fail",
      ack: endAck,
    });
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
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
    endAck,
    checks,
    socketEvents,
    clientSummaries: clients.map((client) => ({
      name: client.name,
      engine: client.engine,
      scenario: client.scenario,
      url: client.url,
      lobby: client.lobby ? {
        ok: client.lobby.ok,
        mode: client.lobby.state?.mode,
        bodyClass: client.lobby.dom?.bodyClass,
      } : null,
      running: client.running ? {
        ok: client.running.ok,
        at: client.running.at,
        timeRemaining: client.running.state?.timeRemaining,
        mode: client.running.state?.mode,
      } : null,
      postGameAt: client.postGameAt || null,
      endedAt: client.endedAt || null,
      durationMs: client.durationMs || null,
      final: client.final,
      timerSummary: timerSummary(client.samples),
      sampleCount: client.samples.length,
      samples: client.samples.map((sample) => ({
        at: sample.at,
        mode: sample.state?.mode || null,
        timeRemaining: sample.state?.timeRemaining ?? null,
        bodyClass: sample.dom?.bodyClass || "",
        compactTime: sample.dom?.compactTime || "",
      })),
      errors: client.errors,
      knownWarnings: client.knownWarnings,
    })),
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    "# Browser Match Lifecycle Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Clients: ${clientsSpec.map((client) => `\`${client.name}:${client.engine}:${client.scenario}\``).join(", ")}`,
    "",
    "## Checks",
    ...checks.map((check) => {
      if (check.durationMs != null) return `- ${statusIcon(check.status)} ${check.name}; duration=${check.durationMs}ms; finalRemaining=${check.finalRemaining}`;
      if (check.endSpreadMs != null) return `- ${statusIcon(check.status)} ${check.name}; spread=${check.endSpreadMs}ms`;
      return `- ${statusIcon(check.status)} ${check.name}`;
    }),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
