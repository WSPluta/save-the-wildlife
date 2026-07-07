#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "human-spawn-overlap-probe");
const DEFAULT_CLIENTS = [
  { name: "QASpawnChrome", engine: "chrome", scenario: "desktop" },
  { name: "QASpawnWebKit", engine: "webkit", scenario: "desktop" },
  { name: "QASpawnChromeMob", engine: "chrome", scenario: "mobile" },
  { name: "QASpawnWebKitMob", engine: "webkit", scenario: "mobile" },
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
    if (text.includes("Failed to load resource") && text.includes("status of 500")) return;
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
    window.__stwlQaSpawnPerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    const perf = window.__stwlQaSpawnPerf;
    const frame = (ts) => {
      if (perf.lastFrameAt) {
        perf.frameDeltas.push(ts - perf.lastFrameAt);
        if (perf.frameDeltas.length > 1200) perf.frameDeltas.shift();
      }
      perf.lastFrameAt = ts;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          if (perf.longTasks.length > 200) perf.longTasks.shift();
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
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    };
    return {
      bodyClass: document.body.className,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      joystick: rectFor("#touch-joystick"),
      compactTime: document.getElementById("compact-time")?.textContent?.trim() || "",
      compactFps: document.getElementById("compact-fps")?.textContent?.trim() || "",
    };
  });
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaSpawnPerf || {};
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

function distance2d(a, b) {
  if (!a || !b) return null;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  return Number(Math.hypot(dx, dz).toFixed(3));
}

function analyzeClient(client, sample, allNames, overlapThreshold) {
  const player = sample?.state?.player || null;
  const remotes = Array.isArray(sample?.state?.remotePlayerSamples) ? sample.state.remotePlayerSamples : [];
  const humanRemotes = remotes.filter((remote) => remote && remote.isBot !== true);
  const overlaps = humanRemotes
    .map((remote) => ({ ...remote, distanceToLocal: distance2d(player, remote) }))
    .filter((remote) => Number.isFinite(remote.distanceToLocal) && remote.distanceToLocal <= overlapThreshold);
  const expectedRemoteNames = allNames.filter((name) => name !== client.name);
  const visibleNames = humanRemotes.map((remote) => String(remote.name || remote.id || ""));
  const missingNames = expectedRemoteNames.filter((name) => !visibleNames.includes(name));
  return {
    name: client.name,
    engine: client.engine,
    scenario: client.scenario,
    player,
    authStateCount: sample?.state?.authStateCount ?? null,
    remoteHumanCount: humanRemotes.length,
    visibleNames,
    missingNames,
    overlapCount: overlaps.length,
    overlaps,
    frame: sample?.state?.frame || null,
    dom: sample?.dom || {},
  };
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
  return { ...clientSpec, browser, context, page, url, ...messages };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const sampleMs = Number(argValue("sample-ms", "5000"));
  const overlapThreshold = Number(argValue("overlap-threshold", "0.5"));
  const room = argValue("room", `QA-SPAWN-${Date.now().toString().slice(-6)}`);
  const clientsSpec = parseClients(argValue("clients", ""));
  const allNames = clientsSpec.map((client) => client.name);
  const checks = [];
  const clients = [];
  let adminSocket = null;
  let startAck = null;

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const playwright = await import(await resolvePlaywrightImport());
    for (const clientSpec of clientsSpec) {
      const client = await openClient({ playwright, clientSpec, baseUrl, room, timeoutMs });
      clients.push(client);
      const lobby = await waitForClient(client, (state, dom) => state && dom.bodyClass?.includes("phase-lobby"), 45000);
      client.lobby = lobby;
      checks.push({
        name: `${client.name} waits in lobby`,
        status: lobby.ok ? "pass" : "fail",
        mode: lobby.state?.mode,
        bodyClass: lobby.dom?.bodyClass,
      });
    }

    adminSocket = await connectSocket(baseUrl);
    startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const runningResults = await Promise.all(clients.map(async (client) => ({
      client,
      running: await waitForClient(client, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass?.includes("phase-gameplay"), 45000),
    })));
    for (const { client, running } of runningResults) {
      client.running = running;
      checks.push({
        name: `${client.name} reaches running`,
        status: running.ok ? "pass" : "fail",
        timeRemaining: running.state?.timeRemaining,
        mode: running.state?.mode,
        bodyClass: running.dom?.bodyClass,
      });
    }

    await sleep(sampleMs);
    const analyses = [];
    for (const client of clients) {
      const sample = await snapshot(client);
      client.sample = sample;
      client.perf = await readPerf(client.page).catch(() => ({}));
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-running.png`), fullPage: true }).catch(() => {});
      const analysis = analyzeClient(client, sample, allNames, overlapThreshold);
      analyses.push(analysis);
      const fps = Number(sample?.state?.frame?.fps || 0);
      const raf = summarizeNumbers(client.perf?.frameDeltas || []);
      checks.push({
        name: `${client.name} has no close overlapping visible human remote`,
        status: analysis.overlapCount === 0 ? "pass" : "fail",
        overlapCount: analysis.overlapCount,
        overlaps: analysis.overlaps,
      });
      checks.push({
        name: `${client.name} sees expected human remotes`,
        status: analysis.missingNames.length === 0 ? "pass" : "fail",
        visibleNames: analysis.visibleNames,
        missingNames: analysis.missingNames,
      });
      checks.push({
        name: `${client.name} frame budget during spawn sample`,
        status: fps >= 45 && Number(raf.p95 || 0) <= 45 ? "pass" : "fail",
        frame: sample?.state?.frame || null,
        rafP95: raf.p95,
        longTasks: client.perf?.longTasks?.length || 0,
      });
      checks.push({
        name: `${client.name} browser errors`,
        status: client.errors.length === 0 ? "pass" : "fail",
        errors: client.errors,
        knownWarnings: client.knownWarnings,
      });
    }

    const anyOverlap = analyses.some((analysis) => analysis.overlapCount > 0);
    const anyMissingHumanRemotes = analyses.some((analysis) => analysis.missingNames.length > 0);
    checks.push({
      name: "room has no visible human spawn/render overlap",
      status: anyOverlap ? "fail" : "pass",
      overlapThreshold,
      overlappingClients: analyses.filter((analysis) => analysis.overlapCount > 0).map((analysis) => analysis.name),
    });
    checks.push({
      name: "room exposes all expected human remotes",
      status: anyMissingHumanRemotes ? "fail" : "pass",
      missingByClient: analyses.map((analysis) => ({ name: analysis.name, missingNames: analysis.missingNames })),
    });
    checks.push({
      name: "clients expose at least one authoritative human state",
      status: analyses.every((analysis) => Number(analysis.authStateCount || 0) >= clientsSpec.length) ? "pass" : "warn",
      authStateCounts: analyses.map((analysis) => ({ name: analysis.name, authStateCount: analysis.authStateCount })),
    });

    await emitAck(adminSocket, "admin.presenter.end", { room }, 8000);
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    for (const client of clients) {
      try { await client.browser.close(); } catch (_) {}
    }
  }

  const analyses = clients.map((client) => analyzeClient(client, client.sample, allNames, overlapThreshold));
  const result = {
    status: checks.every((check) => check.status === "pass" || check.status === "warn")
      && !analyses.some((analysis) => analysis.overlapCount > 0)
      && !analyses.some((analysis) => analysis.missingNames.length > 0)
      ? "pass"
      : "fail",
    startedAt: new Date().toISOString(),
    baseUrl,
    room,
    overlapThreshold,
    clients: clientsSpec,
    startAck,
    checks,
    analyses,
    clientSummaries: clients.map((client) => ({
      name: client.name,
      engine: client.engine,
      scenario: client.scenario,
      url: client.url,
      running: client.running ? {
        ok: client.running.ok,
        timeRemaining: client.running.state?.timeRemaining,
        mode: client.running.state?.mode,
      } : null,
      state: client.sample?.state || null,
      dom: client.sample?.dom || null,
      perf: client.perf || null,
      errors: client.errors,
      knownWarnings: client.knownWarnings,
    })),
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Human Spawn Overlap Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Overlap threshold: ${overlapThreshold}`,
    `- Clients: ${clientsSpec.map((client) => `\`${client.name}:${client.engine}:${client.scenario}\``).join(", ")}`,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
    "",
    "## Overlaps",
    ...analyses.map((analysis) => {
      const overlapText = analysis.overlaps
        .map((remote) => `${remote.name || remote.id} distance=${remote.distanceToLocal}`)
        .join("; ") || "none";
      return `- ${analysis.name}: remoteHumans=${analysis.remoteHumanCount}; overlaps=${overlapText}`;
    }),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
