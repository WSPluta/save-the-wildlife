#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-compute-ui-probe");

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
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

async function installPerfObserver(page) {
  await page.addInitScript(() => {
    window.__stwlQaPerf = {
      frameDeltas: [],
      longTasks: [],
      startedAt: performance.now(),
      lastFrameAt: 0,
    };
    const perf = window.__stwlQaPerf;
    const frame = (ts) => {
      if (perf.lastFrameAt) {
        perf.frameDeltas.push(ts - perf.lastFrameAt);
        if (perf.frameDeltas.length > 2000) perf.frameDeltas.shift();
      }
      perf.lastFrameAt = ts;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
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
      canvas: rectFor("canvas"),
      joystick: rectFor("#touch-joystick"),
      compactHud: rectFor("#hud-compact"),
      hudFps: document.getElementById("compact-fps")?.textContent?.trim() || "",
      lobbyStatus: document.getElementById("lobby-status")?.textContent?.trim() || "",
    };
  });
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaPerf || {};
    const memory = performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
      jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    } : null;
    const resources = performance.getEntriesByType("resource")
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        duration: entry.duration || 0,
      }));
    return {
      frameDeltas: perf.frameDeltas || [],
      longTasks: perf.longTasks || [],
      memory,
      resources,
      now: performance.now(),
    };
  });
}

async function waitForState(page, predicate, timeoutMs) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, {
    timeout: Math.max(timeoutMs, 120000),
  });
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const [state, dom] = await Promise.all([readState(page).catch(() => null), readDom(page).catch(() => ({}))]);
    last = { state, dom };
    if (predicate(state, dom)) return { ok: true, elapsedMs: Date.now() - started, state, dom };
    await sleep(250);
  }
  return { ok: false, elapsedMs: Date.now() - started, ...last };
}

function rectVisible(rect) {
  if (!rect) return false;
  if (rect.display === "none" || rect.visibility === "hidden" || Number(rect.opacity) === 0) return false;
  return rect.width > 20 && rect.height > 20;
}

async function driveDesktop(page, durationMs) {
  await page.click("canvas", { timeout: 5000 }).catch(() => {});
  await page.keyboard.down("ArrowUp").catch(() => {});
  await page.keyboard.down("KeyD").catch(() => {});
  await sleep(Math.floor(durationMs / 3));
  await page.keyboard.up("KeyD").catch(() => {});
  await page.keyboard.down("KeyA").catch(() => {});
  await sleep(Math.floor(durationMs / 3));
  await page.keyboard.up("KeyA").catch(() => {});
  await sleep(Math.max(500, durationMs - Math.floor(durationMs / 3) * 2));
  await page.keyboard.up("ArrowUp").catch(() => {});
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
  await sleep(Math.max(1000, durationMs - 1000));
  await page.mouse.up();
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

function summarizeResources(resources) {
  const totalTransfer = resources.reduce((sum, entry) => sum + Number(entry.transferSize || 0), 0);
  const totalEncoded = resources.reduce((sum, entry) => sum + Number(entry.encodedBodySize || 0), 0);
  const slowest = [...resources]
    .sort((a, b) => Number(b.duration || 0) - Number(a.duration || 0))
    .slice(0, 8)
    .map((entry) => ({
      name: String(entry.name || "").replace(/^https?:\/\/[^/]+/, ""),
      initiatorType: entry.initiatorType,
      duration: Number(Number(entry.duration || 0).toFixed(1)),
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    }));
  return {
    count: resources.length,
    totalTransferBytes: totalTransfer,
    totalEncodedBytes: totalEncoded,
    slowest,
  };
}

function summarizeRun({ samples, perf }) {
  const frames = samples.map((sample) => sample.state?.frame || {});
  const fps = summarizeNumbers(frames.map((frame) => frame.fps));
  const frameMs = summarizeNumbers(frames.map((frame) => frame.frameMs));
  const rawFrameMs = summarizeNumbers(frames.map((frame) => frame.rawFrameMs));
  const rafMs = summarizeNumbers(perf.frameDeltas || []);
  const longTasks = perf.longTasks || [];
  const longTaskDurations = summarizeNumbers(longTasks.map((entry) => entry.duration));
  const resources = summarizeResources(perf.resources || []);
  return {
    sampleCount: samples.length,
    fps,
    frameMs,
    rawFrameMs,
    rafMs,
    longTasks: {
      count: longTasks.length,
      durationMs: longTaskDurations,
    },
    memory: perf.memory,
    resources,
  };
}

async function runScenario({ playwright, engineName, scenario, baseUrl, outputDir, timeoutMs, sampleMs }) {
  const browserType = engineName === "chrome" ? playwright.chromium : playwright[engineName];
  const engineDir = path.join(outputDir, `${engineName}-${scenario}`);
  await fs.mkdir(engineDir, { recursive: true });
  const checks = [];
  const room = `QA-PERF-${engineName}-${scenario}-${Date.now().toString().slice(-6)}`;
  const name = `QA ${engineName} ${scenario}`;
  let browser = null;
  let page = null;
  let adminSocket = null;
  const samples = [];
  const socketEvents = [];
  const errors = [];

  if (!browserType) {
    return { status: "fail", engineName, scenario, room, checks: [{ name: "browser engine available", status: "fail" }] };
  }

  try {
    browser = await browserType.launch({
      headless: true,
      channel: engineName === "chrome" ? "chrome" : undefined,
      args: engineName === "chromium" ? ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] : [],
    });
    const pageOptions = scenario === "mobile"
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
    const context = await browser.newContext(pageOptions);
    page = await context.newPage();
    await installPerfObserver(page);
    errors.push(...collectBrowserErrors(page));

    const playerUrl = `${baseUrl}/?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`;
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
    const lobby = await waitForState(page, (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
    checks.push({
      name: "lobby before presenter start",
      status: lobby.ok ? "pass" : "fail",
      mode: lobby.state?.mode,
      bodyClass: lobby.dom?.bodyClass,
    });

    adminSocket = await connectSocket(baseUrl);
    adminSocket.onAny((event, payload) => {
      if (["game.state", "game.time", "game.on", "game.end"].includes(event)) {
        socketEvents.push({ at: Date.now(), event, payload });
      }
    });
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const running = await waitForState(page, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), 30000);
    checks.push({
      name: "reaches running",
      status: running.ok ? "pass" : "fail",
      elapsedMs: running.elapsedMs,
      timeRemaining: running.state?.timeRemaining,
    });
    await page.screenshot({ path: path.join(engineDir, "running.png"), fullPage: true }).catch(() => {});

    const before = await Promise.all([readState(page), readDom(page)]);
    const drive = scenario === "mobile"
      ? driveMobile(page, before[1].joystick, sampleMs)
      : driveDesktop(page, sampleMs);
    const started = Date.now();
    while (Date.now() - started < sampleMs) {
      const [state, dom] = await Promise.all([readState(page).catch(() => null), readDom(page).catch(() => ({}))]);
      samples.push({ at: Date.now(), state, dom });
      await sleep(500);
    }
    await drive.catch((error) => errors.push({ type: "drive", text: error.message || String(error) }));
    await sleep(1000);
    const after = await Promise.all([readState(page), readDom(page)]);
    const perf = await readPerf(page);
    await page.screenshot({ path: path.join(engineDir, "after-drive.png"), fullPage: true }).catch(() => {});

    const dx = Number(after[0]?.player?.x || 0) - Number(before[0]?.player?.x || 0);
    const dz = Number(after[0]?.player?.z || 0) - Number(before[0]?.player?.z || 0);
    const movementDistance = Math.hypot(dx, dz);
    checks.push({
      name: "drive input moves player",
      status: movementDistance > 0.1 ? "pass" : "fail",
      movementDistance: Number(movementDistance.toFixed(3)),
      beforePlayer: before[0]?.player || null,
      afterPlayer: after[0]?.player || null,
    });
    if (scenario === "mobile") {
      checks.push({
        name: "mobile joystick visible",
        status: rectVisible(before[1].joystick) ? "pass" : "fail",
        joystick: before[1].joystick,
      });
    }
    checks.push({
      name: "browser console/network errors",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
    });

    const compute = summarizeRun({ samples, perf });
    const fpsAvg = Number(compute.fps.avg || 0);
    const frameP95 = Number(compute.frameMs.p95 || 0);
    const rafP95 = Number(compute.rafMs.p95 || 0);
    checks.push({
      name: "compute/frame budget",
      status: fpsAvg >= 45 && frameP95 <= 34 && rafP95 <= 40 ? "pass" : "fail",
      fpsAvg,
      frameP95,
      rafP95,
      longTasks: compute.longTasks.count,
    });

    const failed = checks.filter((check) => check.status === "fail");
    return {
      status: failed.length ? "fail" : "pass",
      engineName,
      scenario,
      room,
      name,
      url: playerUrl,
      userAgent: after[1]?.userAgent || before[1]?.userAgent || null,
      checks,
      compute,
      before: { state: before[0], dom: before[1] },
      after: { state: after[0], dom: after[1] },
      samples,
      socketEvents,
    };
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
    return { status: "fail", engineName, scenario, room, checks, errors, samples, socketEvents };
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const sampleMs = Number(argValue("sample-ms", "12000"));
  const engines = String(argValue("engines", "chromium,webkit")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const scenarios = hasFlag("include-mobile") ? ["desktop", "mobile"] : ["desktop"];
  const startedAt = new Date().toISOString();
  await fs.mkdir(outputDir, { recursive: true });
  const playwright = await import(await resolvePlaywrightImport());
  const results = [];

  for (const engineName of engines) {
    for (const scenario of scenarios) {
      results.push(await runScenario({ playwright, engineName, scenario, baseUrl, outputDir, timeoutMs, sampleMs }));
    }
  }

  const result = {
    status: results.every((entry) => entry.status === "pass") ? "pass" : "fail",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    sampleMs,
    engines,
    scenarios,
    results,
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Browser Compute/UI Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Sample window: ${sampleMs}ms`,
    "",
    "## Checks",
  ];
  for (const entry of results) {
    lines.push(`- ${statusIcon(entry.status)} ${entry.engineName}/${entry.scenario}`);
    for (const check of entry.checks || []) {
      lines.push(`  - ${statusIcon(check.status)} ${check.name}`);
    }
    if (entry.compute) {
      lines.push(`  - FPS avg/p95 frame: ${entry.compute.fps?.avg ?? "-"} / ${entry.compute.frameMs?.p95 ?? "-"}ms`);
      lines.push(`  - RAF p95: ${entry.compute.rafMs?.p95 ?? "-"}ms; long tasks: ${entry.compute.longTasks?.count ?? 0}`);
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
