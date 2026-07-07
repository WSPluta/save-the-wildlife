#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-badge-ui-probe");

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
    window.__stwlBadgeQaPerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    const perf = window.__stwlBadgeQaPerf;
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
    };
  });
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlBadgeQaPerf || {};
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

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function badgePass(badge, maxRatio = 0.7) {
  return Boolean(
    badge &&
    badge.visible === true &&
    Number(badge.fontSize || 0) >= 24 &&
    Number(badge.textWidthRatio || 0) > 0 &&
    Number(badge.textWidthRatio || 0) <= maxRatio,
  );
}

async function runScenario({ playwright, engineName, scenario, baseUrl, outputDir, timeoutMs, sampleMs }) {
  const browserType = engineName === "chrome" ? playwright.chromium : playwright[engineName];
  const engineDir = path.join(outputDir, `${engineName}-${scenario}`);
  await fs.mkdir(engineDir, { recursive: true });
  const room = `QA-BADGE-${engineName[0]}${scenario[0]}-${Date.now().toString().slice(-6)}`;
  const checks = [];
  const errors = [];
  let browser = null;
  let page = null;
  let adminSocket = null;

  if (!browserType) {
    return { status: "fail", engineName, scenario, room, checks: [{ name: "browser engine available", status: "fail" }] };
  }

  try {
    browser = await browserType.launch({
      headless: true,
      channel: engineName === "chrome" ? "chrome" : undefined,
    });
    const context = await browser.newContext(scenario === "mobile"
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await installPerfObserver(page);
    errors.push(...collectBrowserErrors(page));

    await page.goto(`${baseUrl}/?name=QABadge&room=${encodeURIComponent(room)}&visualQa=1`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
    checks.push({
      name: "visual QA hook available",
      status: await page.evaluate(() => !!window.__stwlVisualQa?.showBadges).catch(() => false) ? "pass" : "fail",
    });

    adminSocket = await connectSocket(baseUrl);
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });
    const running = await waitForState(page, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), 45000);
    checks.push({
      name: "reaches running",
      status: running.ok ? "pass" : "fail",
      elapsedMs: running.elapsedMs,
      mode: running.state?.mode,
      bodyClass: running.dom?.bodyClass,
    });

    const forced = await page.evaluate(() => window.__stwlVisualQa.showBadges({
      powerupText: "\u26a1\ufe0f\ud83d\udee1\ufe0f\ud83e\uddf2\u2744\ufe0f",
      statusText: "\u2744\ufe0f 3s",
    }));
    await sleep(sampleMs);
    const [state, dom, perf] = await Promise.all([readState(page), readDom(page), readPerf(page)]);
    await page.screenshot({ path: path.join(engineDir, "badges-forced.png"), fullPage: true }).catch(() => {});

    const fps = summarizeNumbers([state?.frame?.fps]);
    const rafMs = summarizeNumbers(perf.frameDeltas || []);
    checks.push({
      name: "powerup badge visible and not clipped by texture budget",
      status: badgePass(state?.badges?.powerup) ? "pass" : "fail",
      badge: state?.badges?.powerup,
      forced: forced?.powerup,
    });
    checks.push({
      name: "status badge visible and not clipped by texture budget",
      status: badgePass(state?.badges?.status, 0.9) ? "pass" : "fail",
      badge: state?.badges?.status,
      forced: forced?.status,
    });
    if (scenario === "mobile") {
      checks.push({
        name: "mobile joystick visible and separated from HUD",
        status: rectVisible(dom.joystick) && !rectsOverlap(dom.joystick, dom.compactHud) ? "pass" : "fail",
        joystick: dom.joystick,
        compactHud: dom.compactHud,
      });
    }
    checks.push({
      name: "browser console/network errors",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
    });
    checks.push({
      name: "frame budget while badges visible",
      status: Number(state?.frame?.fps || 0) >= 45 && Number(rafMs.p95 || 0) <= 40 ? "pass" : "fail",
      fps: state?.frame,
      rafP95: rafMs.p95,
      longTasks: perf.longTasks?.length || 0,
    });

    const failed = checks.filter((check) => check.status === "fail");
    return {
      status: failed.length ? "fail" : "pass",
      engineName,
      scenario,
      room,
      checks,
      state,
      dom,
      forced,
      compute: { fps, rafMs, longTasks: perf.longTasks?.length || 0, memory: perf.memory },
    };
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
    return { status: "fail", engineName, scenario, room, checks, errors };
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const sampleMs = Number(argValue("sample-ms", "2500"));
  const engines = String(argValue("engines", "chrome,webkit")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const scenarios = hasFlag("include-mobile")
    ? ["desktop", "mobile"]
    : String(argValue("scenarios", "desktop")).split(",").map((entry) => entry.trim()).filter(Boolean);
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
    "# Browser Badge UI Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    "",
    "## Checks",
  ];
  for (const entry of results) {
    lines.push(`- ${statusIcon(entry.status)} ${entry.engineName}/${entry.scenario}`);
    for (const check of entry.checks || []) {
      lines.push(`  - ${statusIcon(check.status)} ${check.name}`);
    }
    if (entry.state?.badges) {
      lines.push(`  - Powerup badge: ${JSON.stringify(entry.state.badges.powerup)}`);
      lines.push(`  - Status badge: ${JSON.stringify(entry.state.badges.status)}`);
    }
    if (entry.compute) {
      lines.push(`  - FPS: ${entry.state?.frame?.fps ?? "-"}; RAF p95: ${entry.compute.rafMs?.p95 ?? "-"}ms; long tasks: ${entry.compute.longTasks}`);
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
