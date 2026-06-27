#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "multiplayer-cross-browser-sync-probe");
const DEFAULT_CLIENTS = [
  { name: "QAMixChrome", engine: "chrome", scenario: "desktop" },
  { name: "QAMixWebKit", engine: "webkit", scenario: "desktop" },
  { name: "QAMixMobile", engine: "chrome", scenario: "mobile" },
];

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
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

function collectBrowserErrors(page) {
  const errors = [];
  const ignoredReplayErrors = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message || String(error) }));
  page.on("console", (msg) => {
    if (!["error", "warning"].includes(msg.type())) return;
    const text = msg.text();
    if (text.includes("/api/replay/events") || text.includes("504")) return;
    if (text.includes("Audio load failed; continuing without engine sound")) return;
    if (text.includes("Automatic fallback to software WebGL")) return;
    if (text.includes("GPU stall due to ReadPixels")) return;
    if (text.includes("Failed to load resource") && text.includes("status of 500")) return;
    errors.push({ type: msg.type(), text });
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const url = response.url();
    if (url.includes("/api/replay/events")) {
      ignoredReplayErrors.push({ status: response.status(), url });
      if (ignoredReplayErrors.length > 20) ignoredReplayErrors.shift();
      return;
    }
    errors.push({ type: "http", status: response.status(), url });
  });
  return errors;
}

async function installPerfObserver(page) {
  await page.addInitScript(() => {
    window.__stwlQaMultiplayerPerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    window.__stwlQaRemoteMotion = { active: false, driverName: null, samples: [] };
    const perf = window.__stwlQaMultiplayerPerf;
    const remoteMotion = window.__stwlQaRemoteMotion;
    const frame = (ts) => {
      if (perf.lastFrameAt) {
        perf.frameDeltas.push(ts - perf.lastFrameAt);
        if (perf.frameDeltas.length > 2000) perf.frameDeltas.shift();
      }
      perf.lastFrameAt = ts;
      if (remoteMotion.active && remoteMotion.driverName) {
        try {
          const raw = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
          const state = raw ? JSON.parse(raw) : null;
          const remotes = Array.isArray(state?.remotePlayerSamples) ? state.remotePlayerSamples : [];
          const driver = remotes.find((sample) => String(sample?.name || sample?.id || "") === remoteMotion.driverName);
          remoteMotion.samples.push({
            ts,
            mode: state?.mode || null,
            timeRemaining: state?.timeRemaining ?? null,
            driverName: remoteMotion.driverName,
            found: !!driver,
            visible: driver?.visible ?? null,
            hasMesh: driver?.hasMesh ?? null,
            source: driver?.source || null,
            visualSource: driver?.visualSource || null,
            x: Number(driver?.x),
            z: Number(driver?.z),
            rotY: Number(driver?.rotY),
            visualX: Number(driver?.visualX),
            visualZ: Number(driver?.visualZ),
            visualRotY: Number(driver?.visualRotY),
            distanceToLocal: Number(driver?.distanceToLocal),
            frame: {
              fps: Number(state?.frame?.fps),
              frameMs: Number(state?.frame?.frameMs),
              rawFrameMs: Number(state?.frame?.rawFrameMs),
              authLagMs: Number(state?.frame?.authLagMs),
            },
          });
          if (remoteMotion.samples.length > 3000) remoteMotion.samples.shift();
        } catch (_) {}
      }
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
    window.__stwlQaStartRemoteMotion = (driverName) => {
      remoteMotion.driverName = String(driverName || "");
      remoteMotion.samples = [];
      remoteMotion.active = true;
    };
    window.__stwlQaStopRemoteMotion = () => {
      remoteMotion.active = false;
      return { driverName: remoteMotion.driverName, samples: remoteMotion.samples || [] };
    };
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
      userAgent: navigator.userAgent,
      joystick: rectFor("#touch-joystick"),
      compactHud: rectFor("#hud-compact"),
    };
  });
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaMultiplayerPerf || {};
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

async function waitForState(page, predicate, timeoutMs) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, {
    timeout: Math.max(timeoutMs, 120000),
  });
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    const [state, dom] = await Promise.all([readState(page).catch(() => null), readDom(page).catch(() => ({}))]);
    latest = { state, dom };
    if (predicate(state, dom)) return { ok: true, elapsedMs: Date.now() - started, state, dom };
    await sleep(250);
  }
  return { ok: false, elapsedMs: Date.now() - started, ...latest };
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

function rectVisible(rect) {
  if (!rect) return false;
  if (rect.display === "none" || rect.visibility === "hidden" || Number(rect.opacity) === 0) return false;
  return rect.width > 20 && rect.height > 20;
}

function movementDelta(before, after) {
  if (!before || !after) return null;
  const dx = Number(after.x || 0) - Number(before.x || 0);
  const dz = Number(after.z || 0) - Number(before.z || 0);
  const dr = Number(after.rotY || 0) - Number(before.rotY || 0);
  return {
    dx: Number(dx.toFixed(3)),
    dz: Number(dz.toFixed(3)),
    dr: Number(dr.toFixed(3)),
    distance: Number(Math.hypot(dx, dz).toFixed(3)),
  };
}

function normalizeAngle(delta) {
  let next = Number(delta) || 0;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

function finiteRemoteSample(sample, useVisual) {
  if (!sample || sample.mode !== "RUNNING" || sample.found !== true) return false;
  const x = useVisual ? sample.visualX : sample.x;
  const z = useVisual ? sample.visualZ : sample.z;
  return Number.isFinite(Number(x)) && Number.isFinite(Number(z)) && Number.isFinite(Number(sample.ts));
}

function summarizeRemoteVisualMotion(samples) {
  const all = Array.isArray(samples) ? samples : [];
  const found = all.filter((sample) => sample?.mode === "RUNNING" && sample.found === true);
  const visual = found.filter((sample) => finiteRemoteSample(sample, true));
  const useVisual = visual.length > 0;
  const motionSamples = (useVisual ? visual : found.filter((sample) => finiteRemoteSample(sample, false)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const steps = [];
  const turnSteps = [];
  for (let i = 1; i < motionSamples.length; i += 1) {
    const previous = motionSamples[i - 1];
    const current = motionSamples[i];
    const dt = Number(current.ts) - Number(previous.ts);
    if (!Number.isFinite(dt) || dt <= 1 || dt > 160) continue;
    const prevX = useVisual ? previous.visualX : previous.x;
    const prevZ = useVisual ? previous.visualZ : previous.z;
    const curX = useVisual ? current.visualX : current.x;
    const curZ = useVisual ? current.visualZ : current.z;
    const prevRot = useVisual ? previous.visualRotY : previous.rotY;
    const curRot = useVisual ? current.visualRotY : current.rotY;
    const dx = Number(curX) - Number(prevX);
    const dz = Number(curZ) - Number(prevZ);
    const step = Math.hypot(dx, dz);
    const speedPerSecond = step / (dt / 1000);
    steps.push({ index: i, ts: current.ts, dt, step, speedPerSecond, from: previous, to: current });
    if (Number.isFinite(Number(prevRot)) && Number.isFinite(Number(curRot))) {
      turnSteps.push(Math.abs(normalizeAngle(Number(curRot) - Number(prevRot))));
    }
  }
  const movingSteps = steps.filter((entry) => entry.step > 0.001);
  const stepStats = summarizeNumbers(movingSteps.map((entry) => entry.step));
  const speedStats = summarizeNumbers(movingSteps.map((entry) => entry.speedPerSecond));
  const turnStats = summarizeNumbers(turnSteps);
  const medianStep = Number(stepStats.median || 0);
  const p95Step = Number(stepStats.p95 || 0);
  const maxAllowedStep = Math.max(0.75, p95Step * 3, medianStep * 12);
  const largeJumps = movingSteps
    .filter((entry) => entry.step > maxAllowedStep)
    .slice(0, 12)
    .map((entry) => ({
      index: entry.index,
      dt: Number(entry.dt.toFixed(2)),
      step: Number(entry.step.toFixed(4)),
      speedPerSecond: Number(entry.speedPerSecond.toFixed(3)),
      from: {
        x: Number((useVisual ? entry.from.visualX : entry.from.x).toFixed(3)),
        z: Number((useVisual ? entry.from.visualZ : entry.from.z).toFixed(3)),
        rotY: Number(Number(useVisual ? entry.from.visualRotY : entry.from.rotY || 0).toFixed(3)),
      },
      to: {
        x: Number((useVisual ? entry.to.visualX : entry.to.x).toFixed(3)),
        z: Number((useVisual ? entry.to.visualZ : entry.to.z).toFixed(3)),
        rotY: Number(Number(useVisual ? entry.to.visualRotY : entry.to.rotY || 0).toFixed(3)),
      },
    }));
  const first = motionSamples[0] || null;
  const last = motionSamples[motionSamples.length - 1] || null;
  const firstX = first ? Number(useVisual ? first.visualX : first.x) : 0;
  const firstZ = first ? Number(useVisual ? first.visualZ : first.z) : 0;
  const lastX = last ? Number(useVisual ? last.visualX : last.x) : 0;
  const lastZ = last ? Number(useVisual ? last.visualZ : last.z) : 0;
  return {
    sampleCount: all.length,
    foundCount: found.length,
    visualSampleCount: visual.length,
    usedVisualMesh: useVisual,
    motionSampleCount: motionSamples.length,
    movingStepCount: movingSteps.length,
    movementDistance: Number(Math.hypot(lastX - firstX, lastZ - firstZ).toFixed(3)),
    stepStats,
    speedStats,
    turnStats,
    maxAllowedStep: Number(maxAllowedStep.toFixed(4)),
    largeJumpCount: largeJumps.length,
    largeJumps,
  };
}

function humanNamesSeenBy(state, ownName, allNames) {
  const expectedRemoteNames = allNames.filter((name) => name !== ownName);
  const samples = Array.isArray(state?.remotePlayerSamples) ? state.remotePlayerSamples : [];
  const visibleHumanNames = samples
    .filter((sample) => sample && sample.isBot !== true)
    .map((sample) => String(sample.name || sample.id || ""));
  return {
    expectedRemoteNames,
    visibleHumanNames,
    missingRemoteNames: expectedRemoteNames.filter((name) => !visibleHumanNames.includes(name)),
    nonBotRemoteCount: visibleHumanNames.length,
  };
}

function remoteDriverSample(state, driverName) {
  const samples = Array.isArray(state?.remotePlayerSamples) ? state.remotePlayerSamples : [];
  return samples.find((sample) => sample && sample.isBot !== true && String(sample.name || sample.id || "") === driverName) || null;
}

async function openClient({ playwright, client, baseUrl, room, outputDir, timeoutMs }) {
  const browserType = client.engine === "chrome" ? playwright.chromium : playwright[client.engine];
  if (!browserType) throw new Error(`Playwright browser engine not available: ${client.engine}`);
  const browser = await browserType.launch({
    headless: true,
    channel: client.engine === "chrome" ? "chrome" : undefined,
  });
  const context = await browser.newContext(client.scenario === "mobile"
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installPerfObserver(page);
  const errors = collectBrowserErrors(page);
  const url = `${baseUrl}/?name=${encodeURIComponent(client.name)}&room=${encodeURIComponent(room)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
  const lobby = await waitForState(page, (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
  await page.screenshot({ path: path.join(outputDir, `${client.name}-lobby.png`), fullPage: true }).catch(() => {});
  return { ...client, browser, context, page, errors, url, lobby };
}

async function driveDesktop(page, durationMs) {
  await page.bringToFront();
  await page.click("canvas", { timeout: 5000 }).catch(() => {});
  await page.keyboard.down("w");
  await page.keyboard.down("d");
  await sleep(Math.max(500, durationMs));
  await page.keyboard.up("d").catch(() => {});
  await page.keyboard.up("w").catch(() => {});
}

async function driveMobile(page, joystick, durationMs) {
  if (!rectVisible(joystick)) {
    await sleep(durationMs);
    return;
  }
  const startX = joystick.left + joystick.width / 2;
  const startY = joystick.top + joystick.height / 2;
  const endX = startX + joystick.width * 0.28;
  const endY = startY - joystick.height * 0.36;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await sleep(Math.max(500, durationMs));
  await page.mouse.up();
}

function parseClients(value, includeWebKitMobile) {
  if (!value) {
    const clients = [...DEFAULT_CLIENTS];
    if (includeWebKitMobile) clients.push({ name: "QAMixWKMobile", engine: "webkit", scenario: "mobile" });
    return clients;
  }
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const [name, engine = idx === 1 ? "webkit" : "chrome", scenario = idx === 2 ? "mobile" : "desktop"] = entry.split(":");
      return { name, engine, scenario };
    });
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const driveMs = Number(argValue("drive-ms", "3500"));
  const room = argValue("room", `QA-MIX-${Date.now().toString().slice(-6)}`);
  const includeWebKitMobile = hasFlag("include-webkit-mobile");
  const strictRemoteVisual = hasFlag("strict-remote-visual");
  const clientsSpec = parseClients(argValue("clients", ""), includeWebKitMobile).slice(0, 4);
  const startedAt = new Date().toISOString();
  const checks = [];
  const events = [];
  const clients = [];
  let adminSocket = null;

  if (clientsSpec.length < 2) throw new Error("At least two clients are required.");
  await fs.mkdir(outputDir, { recursive: true });
  const playwright = await import(await resolvePlaywrightImport());

  try {
    for (const client of clientsSpec) {
      clients.push(await openClient({ playwright, client, baseUrl, room, outputDir, timeoutMs }));
      checks.push({
        name: `${client.name} waits in lobby before admin start`,
        status: clients.at(-1).lobby?.ok ? "pass" : "fail",
        mode: clients.at(-1).lobby?.state?.mode,
        bodyClass: clients.at(-1).lobby?.dom?.bodyClass,
      });
      await sleep(500);
    }

    adminSocket = await connectSocket(baseUrl);
    adminSocket.onAny((event, payload) => {
      if (["game.state", "game.time", "game.on", "game.end", "rooms.update"].includes(event)) {
        events.push({ at: Date.now(), event, payload });
      }
    });
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const runningResults = await Promise.all(clients.map(async (client) => ({
      client,
      running: await waitForState(
        client.page,
        (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"),
        45000,
      ),
    })));
    for (const { client, running } of runningResults) {
      client.running = running;
      checks.push({
        name: `${client.name} reaches running after admin start`,
        status: running.ok ? "pass" : "fail",
        elapsedMs: running.elapsedMs,
        mode: running.state?.mode,
        bodyClass: running.dom?.bodyClass,
        timeRemaining: running.state?.timeRemaining,
      });
    }
    await Promise.all(clients.map((client) =>
      client.page.screenshot({ path: path.join(outputDir, `${client.name}-running.png`), fullPage: true }).catch(() => {})
    ));

    await sleep(1200);
    const before = {};
    for (const client of clients) before[client.name] = await readState(client.page).catch(() => null);

    const driver = clients[0];
    const driverDom = await readDom(driver.page).catch(() => ({}));
    await Promise.all(clients
      .filter((client) => client.name !== driver.name)
      .map((client) => client.page.evaluate((driverName) => {
        if (typeof window.__stwlQaStartRemoteMotion === "function") {
          window.__stwlQaStartRemoteMotion(driverName);
        }
      }, driver.name).catch(() => {})));
    if (driver.scenario === "mobile") await driveMobile(driver.page, driverDom.joystick, driveMs);
    else await driveDesktop(driver.page, driveMs);
    await sleep(2500);

    const after = {};
    const dom = {};
    const perf = {};
    const remoteMotion = {};
    for (const client of clients) {
      if (client.name !== driver.name) {
        remoteMotion[client.name] = await client.page.evaluate(() => {
          if (typeof window.__stwlQaStopRemoteMotion === "function") {
            return window.__stwlQaStopRemoteMotion();
          }
          return { samples: [] };
        }).catch(() => ({ samples: [] }));
      }
      after[client.name] = await readState(client.page).catch(() => null);
      dom[client.name] = await readDom(client.page).catch(() => ({}));
      perf[client.name] = await readPerf(client.page).catch(() => ({}));
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-after-drive.png`), fullPage: true }).catch(() => {});
    }

    const driverDelta = movementDelta(before[driver.name]?.player, after[driver.name]?.player);
    checks.push({
      name: "driver local movement",
      status: driverDelta && (driverDelta.distance > 0.1 || Math.abs(driverDelta.dr) > 0.02) ? "pass" : "fail",
      driver: driver.name,
      delta: driverDelta,
    });

    const names = clients.map((client) => client.name);
    for (const client of clients) {
      const visibility = humanNamesSeenBy(after[client.name], client.name, names);
      checks.push({
        name: `${client.name} sees all human remotes`,
        status: visibility.missingRemoteNames.length === 0 ? "pass" : "fail",
        ...visibility,
        authStateCount: after[client.name]?.authStateCount || 0,
        remotePlayerSamples: after[client.name]?.remotePlayerSamples || [],
        authStateSamples: after[client.name]?.authStateSamples || [],
      });
      if (client.name !== driver.name) {
        const driverRemote = remoteDriverSample(after[client.name], driver.name);
        const remoteMotionSummary = summarizeRemoteVisualMotion(remoteMotion[client.name]?.samples || []);
        const minimumMotionSteps = Math.max(30, Math.floor(driveMs / 80));
        const requireRemoteVisualMotion = strictRemoteVisual || remoteMotionSummary.usedVisualMesh;
        checks.push({
          name: `${client.name} has driver remote mesh`,
          status: driverRemote && driverRemote.hasMesh === true ? "pass" : "fail",
          driver: driver.name,
          driverRemote,
        });
        checks.push({
          name: `${client.name} exposes remote visual mesh telemetry`,
          status: remoteMotionSummary.usedVisualMesh || !strictRemoteVisual ? "pass" : "fail",
          strictRemoteVisual,
          driver: driver.name,
          remoteMotionSummary,
        });
        checks.push({
          name: `${client.name} remote visual motion samples sufficient`,
          status: !requireRemoteVisualMotion || remoteMotionSummary.motionSampleCount >= Math.max(120, Math.floor(driveMs / 30)) ? "pass" : "fail",
          strictRemoteVisual,
          driver: driver.name,
          remoteMotionSummary,
        });
        checks.push({
          name: `${client.name} remote visual driver moves`,
          status: !requireRemoteVisualMotion || (remoteMotionSummary.movementDistance > 0.1 && remoteMotionSummary.movingStepCount >= minimumMotionSteps) ? "pass" : "fail",
          strictRemoteVisual,
          driver: driver.name,
          remoteMotionSummary,
        });
        checks.push({
          name: `${client.name} remote visual path has no large jumps`,
          status: !requireRemoteVisualMotion || remoteMotionSummary.largeJumpCount === 0 ? "pass" : "fail",
          strictRemoteVisual,
          driver: driver.name,
          remoteMotionSummary,
        });
      }
      if (client.scenario === "mobile") {
        checks.push({
          name: `${client.name} mobile joystick visible`,
          status: rectVisible(dom[client.name]?.joystick) ? "pass" : "fail",
          joystick: dom[client.name]?.joystick,
        });
      }
      checks.push({
        name: `${client.name} browser console/network errors`,
        status: client.errors.length === 0 ? "pass" : "fail",
        errors: client.errors,
      });
      const rafMs = summarizeNumbers(perf[client.name]?.frameDeltas || []);
      checks.push({
        name: `${client.name} frame budget`,
        status: Number(after[client.name]?.frame?.fps || 0) >= 45 && Number(rafMs.p95 || 0) <= 40 ? "pass" : "fail",
        frame: after[client.name]?.frame || null,
        rafP95: rafMs.p95,
        longTasks: perf[client.name]?.longTasks?.length || 0,
        memory: perf[client.name]?.memory || null,
      });
    }

    const result = {
      status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      clients: clientsSpec,
      strictRemoteVisual,
      checks,
      before,
      after,
      dom,
      remoteMotion: Object.fromEntries(Object.entries(remoteMotion).map(([name, value]) => [
        name,
        {
          driverName: value?.driverName || driver.name,
          summary: summarizeRemoteVisualMotion(value?.samples || []),
          samplePreview: (value?.samples || []).slice(0, 3).concat((value?.samples || []).slice(-3)),
        },
      ])),
      perf: Object.fromEntries(Object.entries(perf).map(([name, value]) => [
        name,
        {
          rafMs: summarizeNumbers(value?.frameDeltas || []),
          longTasks: value?.longTasks?.length || 0,
          memory: value?.memory || null,
        },
      ])),
      events,
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

    const lines = [
      "# Multiplayer Cross-Browser Sync Probe",
      "",
      `- Status: ${statusIcon(result.status)}`,
      `- Base URL: \`${baseUrl}\``,
      `- Room: \`${room}\``,
      `- Clients: ${clientsSpec.map((client) => `\`${client.name}:${client.engine}:${client.scenario}\``).join(", ")}`,
      `- Strict remote visual: ${strictRemoteVisual ? "yes" : "no"}`,
      "",
      "## Checks",
      ...checks.map((check) => {
        const suffix = check.missingRemoteNames
          ? `; missing=${check.missingRemoteNames.join(",") || "none"}; nonBotRemoteCount=${check.nonBotRemoteCount}`
          : check.remoteMotionSummary
          ? `; visual=${check.remoteMotionSummary.usedVisualMesh}; movement=${check.remoteMotionSummary.movementDistance}; jumps=${check.remoteMotionSummary.largeJumpCount}; maxStep=${check.remoteMotionSummary.stepStats?.max ?? "-"}`
          : "";
        return `- ${statusIcon(check.status)} ${check.name}${suffix}`;
      }),
      "",
      "## Screenshots",
      ...clientsSpec.flatMap((client) => [
        `- \`${client.name}-lobby.png\``,
        `- \`${client.name}-running.png\``,
        `- \`${client.name}-after-drive.png\``,
      ]),
    ];
    await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
    if (result.status !== "pass") process.exitCode = 1;
  } catch (error) {
    const result = {
      status: "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      clients: clientsSpec,
      checks,
      events,
      error: error?.stack || error?.message || String(error),
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "latest.md"), `# Multiplayer Cross-Browser Sync Probe\n\n- Status: FAIL\n- Error: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    for (const client of clients) {
      try { await client.browser.close(); } catch (_) {}
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
