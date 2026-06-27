#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "controls-sign-probe");

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
    window.__stwlQaControlsPerf = {
      frameDeltas: [],
      longTasks: [],
      lastFrameAt: 0,
    };
    const perf = window.__stwlQaControlsPerf;
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
      joystick: rectFor("#touch-joystick"),
      userAgent: navigator.userAgent,
    };
  });
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaControlsPerf || {};
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

function rectVisible(rect) {
  if (!rect) return false;
  if (rect.display === "none" || rect.visibility === "hidden" || Number(rect.opacity) === 0) return false;
  return rect.width > 20 && rect.height > 20;
}

function numberValue(value, digits = 3) {
  const next = Number(value);
  return Number.isFinite(next) ? Number(next.toFixed(digits)) : null;
}

function signedDelta(after, before, key) {
  return numberValue(Number(after?.[key] || 0) - Number(before?.[key] || 0));
}

function playerSnapshot(state) {
  const player = state?.player || {};
  return {
    x: numberValue(player.x),
    z: numberValue(player.z),
    rotY: numberValue(player.rotY),
    speed: numberValue(player.speed),
  };
}

function summarizeControl({ name, before, after, expectedXSign, expectedRotSign, minAbsX = 0.08, minAbsRot = 0.04 }) {
  const beforePlayer = playerSnapshot(before);
  const afterPlayer = playerSnapshot(after);
  const xDelta = signedDelta(afterPlayer, beforePlayer, "x");
  const zDelta = signedDelta(afterPlayer, beforePlayer, "z");
  const rotDelta = signedDelta(afterPlayer, beforePlayer, "rotY");
  const speedDelta = signedDelta(afterPlayer, beforePlayer, "speed");
  const xOk = expectedXSign === 0 ? Math.abs(Number(xDelta || 0)) < minAbsX : Math.sign(Number(xDelta || 0)) === expectedXSign && Math.abs(Number(xDelta || 0)) >= minAbsX;
  const rotOk = expectedRotSign === 0 ? Math.abs(Number(rotDelta || 0)) < minAbsRot : Math.sign(Number(rotDelta || 0)) === expectedRotSign && Math.abs(Number(rotDelta || 0)) >= minAbsRot;
  return {
    name,
    status: xOk && rotOk ? "pass" : "fail",
    expectedXSign,
    expectedRotSign,
    beforePlayer,
    afterPlayer,
    xDelta,
    zDelta,
    rotDelta,
    speedDelta,
  };
}

async function pressKeys(page, keys, holdMs) {
  for (const key of keys) await page.keyboard.down(key);
  await sleep(holdMs);
  for (const key of [...keys].reverse()) await page.keyboard.up(key).catch(() => {});
  await sleep(250);
}

async function dragJoystick(page, joystick, xAxis, yAxis, holdMs) {
  if (!rectVisible(joystick)) return false;
  const centerX = joystick.left + joystick.width / 2;
  const centerY = joystick.top + joystick.height / 2;
  const radius = Math.min(joystick.width, joystick.height) * 0.36;
  const targetX = centerX + Math.max(-1, Math.min(1, xAxis)) * radius;
  const targetY = centerY + Math.max(-1, Math.min(1, yAxis)) * radius;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await sleep(holdMs);
  await page.mouse.up();
  await sleep(250);
  return true;
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizePerf(perf) {
  const frames = (perf.frameDeltas || []).map(Number).filter(Number.isFinite);
  const avg = frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : null;
  return {
    rafAvgMs: numberValue(avg, 2),
    rafP95Ms: numberValue(percentile(frames, 95), 2),
    longTasks: (perf.longTasks || []).length,
    memory: perf.memory,
  };
}

async function runDesktopCase(page, control, holdMs) {
  const before = await readState(page);
  await pressKeys(page, control.keys, holdMs);
  const after = await readState(page);
  return summarizeControl({
    name: control.name,
    before,
    after,
    expectedXSign: control.expectedXSign,
    expectedRotSign: control.expectedRotSign,
  });
}

async function runMobileCase(page, control, holdMs) {
  const before = await readState(page);
  const dom = await readDom(page);
  const moved = await dragJoystick(page, dom.joystick, control.xAxis, control.yAxis, holdMs);
  const after = await readState(page);
  return {
    ...summarizeControl({
      name: control.name,
      before,
      after,
      expectedXSign: control.expectedXSign,
      expectedRotSign: control.expectedRotSign,
    }),
    joystickVisible: rectVisible(dom.joystick),
    joystickMoved: moved,
  };
}

async function runThrottleReleaseCase(page, scenario, holdMs) {
  const before = await readState(page);
  if (scenario === "mobile") {
    const dom = await readDom(page);
    await dragJoystick(page, dom.joystick, 0, -0.9, holdMs);
  } else {
    await pressKeys(page, ["w"], holdMs);
  }
  const afterDrive = await readState(page);
  await sleep(1600);
  const afterRelease = await readState(page);
  const driveSpeed = Number(afterDrive?.player?.speed || 0);
  const releaseSpeed = Number(afterRelease?.player?.speed || 0);
  return {
    name: `${scenario} throttle and release`,
    status: driveSpeed > 0.4 && releaseSpeed < driveSpeed ? "pass" : "fail",
    beforePlayer: playerSnapshot(before),
    afterDrivePlayer: playerSnapshot(afterDrive),
    afterReleasePlayer: playerSnapshot(afterRelease),
    driveSpeed: numberValue(driveSpeed),
    releaseSpeed: numberValue(releaseSpeed),
  };
}

function pageOptionsForScenario(scenario) {
  return scenario === "mobile"
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
}

function controlsForScenario(scenario) {
  if (scenario === "mobile") {
    return [
      { kind: "mobile", name: "joystick up-left should move left", xAxis: -0.65, yAxis: -0.9, expectedXSign: -1, expectedRotSign: -1 },
      { kind: "mobile", name: "joystick up-right should move right", xAxis: 0.65, yAxis: -0.9, expectedXSign: 1, expectedRotSign: 1 },
      { kind: "release", name: "mobile throttle and release" },
    ];
  }
  return [
    { kind: "desktop", name: "A + W should move left", keys: ["w", "a"], expectedXSign: -1, expectedRotSign: -1 },
    { kind: "desktop", name: "D + W should move right", keys: ["w", "d"], expectedXSign: 1, expectedRotSign: 1 },
    { kind: "desktop", name: "ArrowLeft + ArrowUp should move left", keys: ["ArrowUp", "ArrowLeft"], expectedXSign: -1, expectedRotSign: -1 },
    { kind: "desktop", name: "ArrowRight + ArrowUp should move right", keys: ["ArrowUp", "ArrowRight"], expectedXSign: 1, expectedRotSign: 1 },
    { kind: "release", name: "desktop throttle and release" },
  ];
}

async function runIsolatedTrial({ browser, scenario, baseUrl, scenarioDir, timeoutMs, holdMs, engineName, control, index }) {
  const trialSlug = control.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const room = `QA-CTRL-${engineName}-${scenario}-${index}-${Date.now().toString().slice(-5)}`;
  const name = `QA ${control.name}`;
  const checks = [];
  const errors = [];
  let context = null;
  let page = null;
  let adminSocket = null;

  try {
    context = await browser.newContext(pageOptionsForScenario(scenario));
    page = await context.newPage();
    await installPerfObserver(page);
    errors.push(...collectBrowserErrors(page));
    await page.goto(`${baseUrl}/?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const lobby = await waitForState(page, (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
    checks.push({ name: "lobby before presenter start", status: lobby.ok ? "pass" : "fail", mode: lobby.state?.mode });

    adminSocket = await connectSocket(baseUrl);
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const running = await waitForState(page, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), timeoutMs);
    checks.push({ name: "reaches running", status: running.ok ? "pass" : "fail", elapsedMs: running.elapsedMs, timeRemaining: running.state?.timeRemaining });
    await page.screenshot({ path: path.join(scenarioDir, `${trialSlug}-running.png`), fullPage: true }).catch(() => {});

    let controlResult = {
      name: control.name,
      status: "fail",
      reason: "did not reach running",
    };
    if (running.ok && control.kind === "desktop") controlResult = await runDesktopCase(page, control, holdMs);
    if (running.ok && control.kind === "mobile") controlResult = await runMobileCase(page, control, holdMs);
    if (running.ok && control.kind === "release") controlResult = await runThrottleReleaseCase(page, scenario, holdMs);

    await page.screenshot({ path: path.join(scenarioDir, `${trialSlug}-after.png`), fullPage: true }).catch(() => {});
    const perf = summarizePerf(await readPerf(page));
    checks.push({
      name: "browser console/network errors",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
    });
    checks.push({
      name: "control outcome",
      status: controlResult.status,
      control: controlResult.name,
    });
    checks.push({
      name: "frame timing during control",
      status: !perf.rafP95Ms || perf.rafP95Ms <= 40 ? "pass" : "fail",
      perf,
    });

    const failed = checks.filter((check) => check.status === "fail");
    return {
      status: failed.length ? "fail" : "pass",
      room,
      name,
      control: control.name,
      checks,
      controlResult,
      perf,
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null),
    };
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
    return { status: "fail", room, name, control: control.name, checks, controlResult: { name: control.name, status: "fail" } };
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    try { if (context) await context.close(); } catch (_) {}
  }
}

async function runScenario({ playwright, engineName, scenario, baseUrl, outputDir, timeoutMs, holdMs }) {
  const browserType = engineName === "chrome" ? playwright.chromium : playwright[engineName];
  const scenarioDir = path.join(outputDir, `${engineName}-${scenario}`);
  await fs.mkdir(scenarioDir, { recursive: true });
  const checks = [];
  const trials = [];
  let browser = null;

  if (!browserType) {
    return { status: "fail", engineName, scenario, checks: [{ name: "browser engine available", status: "fail" }] };
  }

  try {
    browser = await browserType.launch({
      headless: true,
      channel: engineName === "chrome" ? "chrome" : undefined,
    });

    const controls = controlsForScenario(scenario);
    for (let index = 0; index < controls.length; index++) {
      trials.push(await runIsolatedTrial({
        browser,
        scenario,
        baseUrl,
        scenarioDir,
        timeoutMs,
        holdMs,
        engineName,
        control: controls[index],
        index: index + 1,
      }));
    }

    const trialChecks = trials.flatMap((trial) => trial.checks || []);
    const controlResults = trials.map((trial) => trial.controlResult).filter(Boolean);
    const perfFailures = trialChecks.filter((check) => check.name === "frame timing during control" && check.status === "fail");
    const errorFailures = trialChecks.filter((check) => check.name === "browser console/network errors" && check.status === "fail");
    const lifecycleFailures = trialChecks.filter((check) => ["lobby before presenter start", "presenter start accepted", "reaches running"].includes(check.name) && check.status === "fail");

    checks.push({
      name: "all trials reach running",
      status: lifecycleFailures.length === 0 ? "pass" : "fail",
      failures: lifecycleFailures.map((check) => check.name),
    });
    checks.push({
      name: "browser console/network errors",
      status: errorFailures.length === 0 ? "pass" : "fail",
      failures: errorFailures.length,
    });
    checks.push({
      name: "controls direction and release",
      status: controlResults.length > 0 && controlResults.every((entry) => entry.status === "pass") ? "pass" : "fail",
      failures: controlResults.filter((entry) => entry.status === "fail").map((entry) => entry.name),
    });
    checks.push({
      name: "frame timing during controls",
      status: perfFailures.length === 0 ? "pass" : "fail",
      failures: perfFailures.length,
    });

    const failed = checks.filter((check) => check.status === "fail");
    return {
      status: failed.length ? "fail" : "pass",
      engineName,
      scenario,
      checks,
      trials,
      controlResults,
    };
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
    return { status: "fail", engineName, scenario, checks, trials };
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "90000"));
  const holdMs = Number(argValue("hold-ms", "1200"));
  const engines = String(argValue("engines", "chrome")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const scenariosArg = argValue("scenarios", "");
  const scenarios = scenariosArg
    ? scenariosArg.split(",").map((entry) => entry.trim()).filter(Boolean)
    : (hasFlag("include-mobile") ? ["desktop", "mobile"] : ["desktop"]);
  await fs.mkdir(outputDir, { recursive: true });
  const playwright = await import(await resolvePlaywrightImport());
  const results = [];

  for (const engineName of engines) {
    for (const scenario of scenarios) {
      results.push(await runScenario({ playwright, engineName, scenario, baseUrl, outputDir, timeoutMs, holdMs }));
    }
  }

  const result = {
    status: results.every((entry) => entry.status === "pass") ? "pass" : "fail",
    startedAt: new Date().toISOString(),
    baseUrl,
    holdMs,
    engines,
    scenarios,
    results,
  };
  result.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    "# Controls Sign Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Hold duration: ${holdMs}ms`,
    "",
    "## Checks",
  ];
  for (const entry of results) {
    lines.push(`- ${statusIcon(entry.status)} ${entry.engineName}/${entry.scenario}`);
    for (const check of entry.checks || []) {
      lines.push(`  - ${statusIcon(check.status)} ${check.name}`);
      if (check.name === "controls direction and release" && check.failures?.length) {
        lines.push(`    - Failures: ${check.failures.join(", ")}`);
      }
    }
    for (const control of entry.controlResults || []) {
      lines.push(`  - ${statusIcon(control.status)} ${control.name}: x ${control.xDelta ?? "-"}, rot ${control.rotDelta ?? "-"}, speed ${control.speedDelta ?? control.driveSpeed ?? "-"}`);
    }
    if (entry.perf) {
      lines.push(`  - RAF p95: ${entry.perf.rafP95Ms ?? "-"}ms; long tasks: ${entry.perf.longTasks ?? 0}`);
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
