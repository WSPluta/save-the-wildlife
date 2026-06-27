#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "qa-browser-motion-smoothness");

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

async function installMotionSampler(page) {
  await page.addInitScript(() => {
    window.__stwlQaMotion = {
      active: false,
      frameDeltas: [],
      lastFrameAt: 0,
      longTasks: [],
      samples: [],
    };
    const qa = window.__stwlQaMotion;
    const frame = (ts) => {
      if (qa.lastFrameAt) {
        qa.frameDeltas.push(ts - qa.lastFrameAt);
        if (qa.frameDeltas.length > 4000) qa.frameDeltas.shift();
      }
      qa.lastFrameAt = ts;
      if (qa.active) {
        try {
          const raw = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
          const state = raw ? JSON.parse(raw) : null;
          const player = state?.player || {};
          const frameState = state?.frame || {};
          qa.samples.push({
            ts,
            mode: state?.mode || null,
            timeRemaining: state?.timeRemaining ?? null,
            player: {
              x: Number(player.x),
              y: Number(player.y),
              z: Number(player.z),
              rotY: Number(player.rotY),
              speed: Number(player.speed),
            },
            frame: {
              fps: Number(frameState.fps),
              frameMs: Number(frameState.frameMs),
              rawFrameMs: Number(frameState.rawFrameMs),
              authLagMs: Number(frameState.authLagMs),
            },
          });
          if (qa.samples.length > 5000) qa.samples.shift();
        } catch (_) {}
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          qa.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          if (qa.longTasks.length > 500) qa.longTasks.shift();
        }
      });
      obs.observe({ type: "longtask", buffered: true });
    } catch (_) {}
    window.__stwlQaStartMotion = () => {
      qa.samples = [];
      qa.active = true;
    };
    window.__stwlQaStopMotion = () => {
      qa.active = false;
      return {
        samples: qa.samples,
        frameDeltas: qa.frameDeltas,
        longTasks: qa.longTasks,
        memory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        } : null,
      };
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
  await page.keyboard.down("KeyW");
  await sleep(Math.floor(durationMs * 0.35));
  await page.keyboard.down("KeyD");
  await sleep(Math.floor(durationMs * 0.25));
  await page.keyboard.up("KeyD").catch(() => {});
  await page.keyboard.down("KeyA");
  await sleep(Math.floor(durationMs * 0.25));
  await page.keyboard.up("KeyA").catch(() => {});
  await sleep(Math.max(250, Math.floor(durationMs * 0.15)));
  await page.keyboard.up("KeyW").catch(() => {});
}

async function driveMobile(page, joystick, durationMs) {
  if (!rectVisible(joystick)) {
    await sleep(durationMs);
    return;
  }
  const startX = joystick.left + joystick.width / 2;
  const startY = joystick.top + joystick.height / 2;
  const rightX = startX + joystick.width * 0.30;
  const leftX = startX - joystick.width * 0.30;
  const upY = startY - joystick.height * 0.38;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, upY, { steps: 10 });
  await sleep(Math.floor(durationMs * 0.35));
  await page.mouse.move(rightX, upY, { steps: 12 });
  await sleep(Math.floor(durationMs * 0.25));
  await page.mouse.move(leftX, upY, { steps: 16 });
  await sleep(Math.floor(durationMs * 0.25));
  await page.mouse.move(startX, upY, { steps: 10 });
  await sleep(Math.max(250, Math.floor(durationMs * 0.15)));
  await page.mouse.up();
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeNumbers(values, digits = 3) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return { count: 0 };
  const sum = finite.reduce((acc, value) => acc + value, 0);
  return {
    count: finite.length,
    min: Number(Math.min(...finite).toFixed(digits)),
    avg: Number((sum / finite.length).toFixed(digits)),
    median: Number(percentile(finite, 50).toFixed(digits)),
    p95: Number(percentile(finite, 95).toFixed(digits)),
    max: Number(Math.max(...finite).toFixed(digits)),
  };
}

function normalizeAngle(delta) {
  let next = delta;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

function finitePlayer(sample) {
  const player = sample?.player || {};
  return Number.isFinite(player.x) && Number.isFinite(player.z) && Number.isFinite(sample?.ts);
}

function summarizeMotion(samples) {
  const running = samples.filter((sample) => sample.mode === "RUNNING" && finitePlayer(sample));
  const steps = [];
  const turnSteps = [];
  for (let i = 1; i < running.length; i += 1) {
    const previous = running[i - 1];
    const current = running[i];
    const dt = Number(current.ts) - Number(previous.ts);
    if (!Number.isFinite(dt) || dt <= 1 || dt > 120) continue;
    const dx = current.player.x - previous.player.x;
    const dz = current.player.z - previous.player.z;
    const step = Math.hypot(dx, dz);
    const speedPerSecond = step / (dt / 1000);
    steps.push({ index: i, ts: current.ts, dt, step, speedPerSecond, from: previous.player, to: current.player });
    if (Number.isFinite(current.player.rotY) && Number.isFinite(previous.player.rotY)) {
      turnSteps.push(Math.abs(normalizeAngle(current.player.rotY - previous.player.rotY)));
    }
  }
  const movingSteps = steps.filter((entry) => entry.step > 0.001);
  const stepStats = summarizeNumbers(movingSteps.map((entry) => entry.step), 4);
  const speedStats = summarizeNumbers(movingSteps.map((entry) => entry.speedPerSecond), 3);
  const turnStats = summarizeNumbers(turnSteps, 4);
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
        x: Number(entry.from.x.toFixed(3)),
        z: Number(entry.from.z.toFixed(3)),
        rotY: Number(Number(entry.from.rotY || 0).toFixed(3)),
      },
      to: {
        x: Number(entry.to.x.toFixed(3)),
        z: Number(entry.to.z.toFixed(3)),
        rotY: Number(Number(entry.to.rotY || 0).toFixed(3)),
      },
    }));
  const first = running[0]?.player || null;
  const last = running[running.length - 1]?.player || null;
  const movementDistance = first && last ? Math.hypot(last.x - first.x, last.z - first.z) : 0;
  return {
    sampleCount: samples.length,
    runningSampleCount: running.length,
    movingStepCount: movingSteps.length,
    movementDistance: Number(movementDistance.toFixed(3)),
    stepStats,
    speedStats,
    turnStats,
    maxAllowedStep: Number(maxAllowedStep.toFixed(4)),
    largeJumpCount: largeJumps.length,
    largeJumps,
  };
}

function summarizeFrame(samples, frameDeltas, longTasks) {
  return {
    fps: summarizeNumbers(samples.map((sample) => sample.frame?.fps), 2),
    frameMs: summarizeNumbers(samples.map((sample) => sample.frame?.frameMs), 2),
    rawFrameMs: summarizeNumbers(samples.map((sample) => sample.frame?.rawFrameMs), 2),
    authLagMs: summarizeNumbers(samples.map((sample) => sample.frame?.authLagMs), 2),
    rafMs: summarizeNumbers(frameDeltas || [], 2),
    longTasks: {
      count: Array.isArray(longTasks) ? longTasks.length : 0,
      durationMs: summarizeNumbers((longTasks || []).map((entry) => entry.duration), 2),
    },
  };
}

function frameBudgetStatus(frameSummary) {
  const fpsAvg = Number(frameSummary?.fps?.avg || 0);
  const rafP95 = Number(frameSummary?.rafMs?.p95 || 0);
  if (fpsAvg >= 45 && rafP95 <= 40) return "pass";
  // Headless Chrome on some hosts presents at a steady 30 Hz. Treat that as a
  // refresh-rate warning when motion deltas are smooth, not as a gameplay jump.
  if (fpsAvg >= 28 && rafP95 <= 40) return "warn";
  return "fail";
}

function requiredMotionSamples(sampleMs, frameSummary) {
  const fpsAvg = Number(frameSummary?.fps?.avg || 0);
  const expectedHz = Math.max(20, Math.min(60, Number.isFinite(fpsAvg) && fpsAvg > 0 ? fpsAvg : 30));
  return Math.max(90, Math.floor((sampleMs / 1000) * expectedHz * 0.65));
}

async function runScenario({ playwright, engineName, scenario, baseUrl, outputDir, timeoutMs, sampleMs }) {
  const browserType = engineName === "chrome" ? playwright.chromium : playwright[engineName];
  const scenarioDir = path.join(outputDir, `${engineName}-${scenario}`);
  await fs.mkdir(scenarioDir, { recursive: true });
  const room = `QA-MOTION-${engineName}-${scenario}-${Date.now().toString().slice(-6)}`;
  const name = `QAMotion${engineName}${scenario}`;
  const checks = [];
  const errors = [];
  let browser = null;
  let adminSocket = null;

  if (!browserType) {
    return { status: "fail", engineName, scenario, room, checks: [{ name: "browser engine available", status: "fail" }] };
  }

  try {
    browser = await browserType.launch({
      headless: true,
      channel: engineName === "chrome" ? "chrome" : undefined,
      args: engineName === "chromium" ? ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] : [],
    });
    const context = await browser.newContext(
      scenario === "mobile"
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    );
    const page = await context.newPage();
    await installMotionSampler(page);
    errors.push(...collectBrowserErrors(page));

    const url = `${baseUrl}/?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
    const lobby = await waitForState(page, (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
    checks.push({ name: "waits in lobby before presenter start", status: lobby.ok ? "pass" : "fail", mode: lobby.state?.mode, bodyClass: lobby.dom?.bodyClass });

    adminSocket = await connectSocket(baseUrl);
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const running = await waitForState(page, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), 35000);
    checks.push({ name: "reaches running", status: running.ok ? "pass" : "fail", elapsedMs: running.elapsedMs, timeRemaining: running.state?.timeRemaining });
    await page.screenshot({ path: path.join(scenarioDir, "running.png"), fullPage: true }).catch(() => {});

    const before = await Promise.all([readState(page), readDom(page)]);
    if (scenario === "mobile") {
      checks.push({ name: "mobile joystick visible", status: rectVisible(before[1].joystick) ? "pass" : "fail", joystick: before[1].joystick });
    }
    await page.evaluate(() => window.__stwlQaStartMotion());
    const drive = scenario === "mobile" ? driveMobile(page, before[1].joystick, sampleMs) : driveDesktop(page, sampleMs);
    await drive.catch((error) => errors.push({ type: "drive", text: error.message || String(error) }));
    await sleep(400);
    const motion = await page.evaluate(() => window.__stwlQaStopMotion());
    const after = await Promise.all([readState(page), readDom(page)]);
    await page.screenshot({ path: path.join(scenarioDir, "after-drive.png"), fullPage: true }).catch(() => {});

    const motionSummary = summarizeMotion(motion.samples || []);
    const frameSummary = summarizeFrame(motion.samples || [], motion.frameDeltas || [], motion.longTasks || []);
    const minMotionSamples = requiredMotionSamples(sampleMs, frameSummary);
    checks.push({
      name: "steady input moves player",
      status: motionSummary.movementDistance > 0.4 ? "pass" : "fail",
      movementDistance: motionSummary.movementDistance,
      beforePlayer: before[0]?.player || null,
      afterPlayer: after[0]?.player || null,
    });
    checks.push({
      name: "motion samples sufficient",
      status: motionSummary.runningSampleCount >= minMotionSamples ? "pass" : "fail",
      runningSampleCount: motionSummary.runningSampleCount,
      movingStepCount: motionSummary.movingStepCount,
      requiredSamples: minMotionSamples,
    });
    checks.push({
      name: "no large frame-to-frame position jumps",
      status: motionSummary.largeJumpCount === 0 ? "pass" : "fail",
      largeJumpCount: motionSummary.largeJumpCount,
      maxAllowedStep: motionSummary.maxAllowedStep,
      stepStats: motionSummary.stepStats,
      largeJumps: motionSummary.largeJumps,
    });
    checks.push({
      name: "frame budget during motion",
      status: frameBudgetStatus(frameSummary),
      fpsAvg: frameSummary.fps.avg,
      rafP95: frameSummary.rafMs.p95,
      longTasks: frameSummary.longTasks.count,
    });
    checks.push({
      name: "browser console/network errors",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
    });

    const failed = checks.filter((check) => check.status === "fail");
    return {
      status: failed.length ? "fail" : "pass",
      engineName,
      scenario,
      room,
      name,
      url,
      userAgent: after[1]?.userAgent || before[1]?.userAgent || null,
      checks,
      motionSummary,
      frameSummary,
      memory: motion.memory || null,
      before: { state: before[0], dom: before[1] },
      after: { state: after[0], dom: after[1] },
      samplePreview: (motion.samples || []).slice(0, 3).concat((motion.samples || []).slice(-3)),
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
  const timeoutMs = Number(argValue("timeout-ms", "150000"));
  const sampleMs = Number(argValue("sample-ms", "12000"));
  const engines = String(argValue("engines", "chrome,webkit")).split(",").map((entry) => entry.trim()).filter(Boolean);
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
    status: results.every((entry) => entry.status !== "fail") ? "pass" : "fail",
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
    "# Browser Motion Smoothness Probe",
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
      const suffix = check.name === "no large frame-to-frame position jumps"
        ? `; jumps=${check.largeJumpCount}; maxAllowedStep=${check.maxAllowedStep}; maxStep=${check.stepStats?.max ?? "-"}`
        : check.name === "motion samples sufficient"
        ? `; samples=${check.runningSampleCount}; required=${check.requiredSamples}`
        : "";
      lines.push(`  - ${statusIcon(check.status)} ${check.name}${suffix}`);
    }
    if (entry.motionSummary) {
      lines.push(`  - Movement distance: ${entry.motionSummary.movementDistance}; moving steps: ${entry.motionSummary.movingStepCount}`);
      lines.push(`  - Step median/p95/max: ${entry.motionSummary.stepStats?.median ?? "-"} / ${entry.motionSummary.stepStats?.p95 ?? "-"} / ${entry.motionSummary.stepStats?.max ?? "-"}`);
    }
    if (entry.frameSummary) {
      lines.push(`  - FPS avg / RAF p95: ${entry.frameSummary.fps?.avg ?? "-"} / ${entry.frameSummary.rafMs?.p95 ?? "-"}ms`);
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
