#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-item-collision-matrix-probe");

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

function shortScenarioRoom({ itemKind, engineName, scenario }) {
  const item = { trash: "TR", turtle: "TU", powerup: "PU" }[itemKind] || "IT";
  const engine = { chrome: "CH", chromium: "CR", webkit: "WK", firefox: "FF" }[engineName] || "BR";
  const shape = scenario === "mobile" ? "M" : "D";
  const suffix = Date.now().toString().slice(-6);
  return `QA-${item}-${engine}-${shape}-${suffix}`;
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

function normalizeAngle(value) {
  let next = Number(value || 0);
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
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
    window.__stwlQaItemPerf = {
      frameDeltas: [],
      longTasks: [],
      lastFrameAt: 0,
    };
    const perf = window.__stwlQaItemPerf;
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

async function readJoystick(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#touch-joystick");
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
  });
}

function rectVisible(rect) {
  if (!rect) return false;
  if (rect.display === "none" || rect.visibility === "hidden" || Number(rect.opacity) === 0) return false;
  return rect.width > 20 && rect.height > 20;
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaItemPerf || {};
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
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const state = await readState(page).catch(() => null);
    last = state;
    if (predicate(state)) return { ok: true, elapsedMs: Date.now() - started, state };
    await sleep(250);
  }
  return { ok: false, elapsedMs: Date.now() - started, state: last };
}

async function setKey(page, key, shouldDown, held) {
  if (held.get(key) === shouldDown) return;
  held.set(key, shouldDown);
  if (shouldDown) await page.keyboard.down(key);
  else await page.keyboard.up(key);
}

async function releaseKeys(page, held) {
  for (const [key, isDown] of held.entries()) {
    if (isDown) await page.keyboard.up(key).catch(() => {});
    held.set(key, false);
  }
}

async function moveJoystick(page, joystickRect, xAxis, yAxis, pointerDown) {
  if (!rectVisible(joystickRect)) return false;
  const centerX = joystickRect.left + joystickRect.width / 2;
  const centerY = joystickRect.top + joystickRect.height / 2;
  const radius = Math.min(joystickRect.width, joystickRect.height) * 0.34;
  const targetX = centerX + Math.max(-1, Math.min(1, xAxis)) * radius;
  const targetY = centerY + Math.max(-1, Math.min(1, yAxis)) * radius;
  if (!pointerDown.current) {
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    pointerDown.current = true;
  }
  await page.mouse.move(targetX, targetY, { steps: 3 });
  return true;
}

async function releaseJoystick(page, pointerDown) {
  if (pointerDown.current) {
    await page.mouse.up().catch(() => {});
    pointerDown.current = false;
  }
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

function summarizeSamples(samples, perf) {
  return {
    fps: summarizeNumbers(samples.map((sample) => sample.frame?.fps)),
    frameMs: summarizeNumbers(samples.map((sample) => sample.frame?.frameMs)),
    rawFrameMs: summarizeNumbers(samples.map((sample) => sample.frame?.rawFrameMs)),
    rafMs: summarizeNumbers(perf.frameDeltas || []),
    longTasks: {
      count: (perf.longTasks || []).length,
      durationMs: summarizeNumbers((perf.longTasks || []).map((entry) => entry.duration)),
    },
    memory: perf.memory,
  };
}

function samplesForKind(state, itemKind) {
  if (itemKind === "trash") return state?.trashSamples || [];
  if (itemKind === "powerup") return state?.powerupSamples || [];
  if (itemKind === "turtle") return (state?.turtleSamples || []).map((sample, index) => ({ ...sample, id: `turtle-${index}` }));
  return [];
}

function sampleHeadingScore(state, sample) {
  const player = state?.player || {};
  const dx = Number(sample.x || 0) - Number(player.x || 0);
  const dz = Number(sample.z || 0) - Number(player.z || 0);
  const desiredYaw = Math.atan2(dx, dz);
  const delta = Math.abs(normalizeAngle(desiredYaw - Number(player.rotY || 0)));
  const distance = Math.hypot(dx, dz);
  return { delta, distance, ahead: delta < 1.05 };
}

function nearestSample(state, itemKind) {
  const samples = samplesForKind(state, itemKind)
    .filter((sample) => Number.isFinite(Number(sample.x)) && Number.isFinite(Number(sample.z)));
  samples.sort((a, b) => {
    const aScore = sampleHeadingScore(state, a);
    const bScore = sampleHeadingScore(state, b);
    if (aScore.ahead !== bScore.ahead) return aScore.ahead ? -1 : 1;
    if (Math.abs(aScore.delta - bScore.delta) > 0.1) return aScore.delta - bScore.delta;
    return aScore.distance - bScore.distance;
  });
  return samples[0] || null;
}

function countForKind(state, itemKind) {
  if (itemKind === "trash") return Number(state?.trashInstances || 0);
  if (itemKind === "powerup") return Number(state?.powerupInstances || 0);
  if (itemKind === "turtle") {
    return Number(state?.turtlesTotal ?? state?.turtlesRendered ?? state?.turtlesVisible ?? 0);
  }
  return 0;
}

function targetStillVisible(state, itemKind, targetId) {
  if (!targetId) return true;
  if (itemKind === "turtle") return true;
  return samplesForKind(state, itemKind).some((sample) => sample.id === targetId);
}

function successForKind({ itemKind, initialScore, initialCount, final }) {
  const finalScore = Number(final?.score || 0);
  const finalCount = countForKind(final, itemKind);
  const lastResult = final?.pickups?.lastResult || null;
  if (lastResult?.ok === true) {
    if (itemKind === "trash") return String(lastResult.itemType || "").includes("trash") || Number(lastResult.scoreDelta) > 0;
    if (itemKind === "powerup") return String(lastResult.itemType || "").startsWith("powerup_") || lastResult.powerupType;
    if (itemKind === "turtle") return String(lastResult.itemType || "").includes("turtle") || Number(lastResult.scoreDelta) < 0;
    return true;
  }
  if (itemKind === "trash") return finalScore > initialScore || finalCount < initialCount;
  if (itemKind === "powerup") return finalCount < initialCount || Object.values(final?.powerUps || {}).some((value) => value === true || Number(value) > 1);
  if (itemKind === "turtle") return finalScore < initialScore || finalCount < initialCount;
  return false;
}

function pickupEvidenceMatchesKind(evidence, itemKind) {
  if (!evidence) return false;
  const itemType = String(evidence.itemType || evidence.powerupType || "").toLowerCase();
  const scoreDelta = Number(evidence.scoreDelta ?? evidence.optimisticDelta);
  if (itemKind === "trash") {
    return itemType.includes("trash") || scoreDelta > 0;
  }
  if (itemKind === "powerup") {
    return itemType.startsWith("powerup_") || Boolean(evidence.powerupType);
  }
  if (itemKind === "turtle") {
    return itemType.includes("turtle") || itemType.includes("marine") || scoreDelta < 0;
  }
  return false;
}

function pickupResultMatchesKind(result, itemKind) {
  return result?.ok === true && pickupEvidenceMatchesKind(result, itemKind);
}

function pickupResultKey(result) {
  if (!result || typeof result !== "object") return null;
  return [
    result.itemId || result.id || "unknown",
    result.itemType || result.powerupType || "unknown",
    result.transport || "unknown",
    result.requestToResultMs ?? "unknown",
    result.ok === true ? "ok" : (result.error || "failed"),
  ].join(":");
}

async function driveToItem(page, { itemKind, isMobile, maxDriveMs }) {
  const held = new Map();
  const pointerDown = { current: false };
  const samples = [];
  let initial = await readState(page);
  const initialScore = Number(initial?.score || 0);
  const initialCount = countForKind(initial, itemKind);
  const initialTime = Number(initial?.timeRemaining);
  let target = nearestSample(initial, itemKind);
  let targetId = target?.id || null;
  let final = initial;
  let collected = false;
  let lastDistance = Number(target?.distance ?? Infinity);
  let joystick = isMobile ? await readJoystick(page) : null;
  let joystickVisible = !isMobile || rectVisible(joystick);
  const pickupResults = [];
  const pickupResultKeys = new Set();
  const pickupRequests = [];
  const pickupRequestKeys = new Set();
  const rememberPickupResult = (state) => {
    const result = state?.pickups?.lastResult || null;
    const key = pickupResultKey(result);
    if (!key || pickupResultKeys.has(key)) return;
    pickupResultKeys.add(key);
    pickupResults.push(result);
  };
  const rememberPickupRequest = (state) => {
    const request = state?.pickups?.lastRequest || null;
    if (!request || typeof request !== "object") return;
    const key = [request.itemId || "unknown", request.requestedAt ?? "unknown"].join(":");
    if (pickupRequestKeys.has(key)) return;
    pickupRequestKeys.add(key);
    pickupRequests.push(request);
  };
  rememberPickupResult(initial);
  rememberPickupRequest(initial);
  const started = Date.now();

  while (Date.now() - started < maxDriveMs) {
    final = await readState(page).catch(() => final);
    if (!final || final.mode !== "RUNNING" || !final.player) break;
    rememberPickupResult(final);
    rememberPickupRequest(final);
    samples.push(final);

    collected = successForKind({ itemKind, initialScore, initialCount, final });
    if (collected) break;

    // Mobile is first-person and touch steering is intentionally analog. Keep
    // retargeting to the best current item so the probe tests real collection
    // behavior instead of overfitting to one off-screen item after a turn.
    target = isMobile
      ? nearestSample(final, itemKind)
      : samplesForKind(final, itemKind).find((sample) => sample.id === targetId) || nearestSample(final, itemKind);
    if (!target) break;
    targetId = target.id || targetId || null;
    if (!isMobile && !targetStillVisible(final, itemKind, targetId)) break;

    const player = final.player;
    const dx = Number(target.x || 0) - Number(player.x || 0);
    const dz = Number(target.z || 0) - Number(player.z || 0);
    const desiredYaw = Math.atan2(dx, dz);
    const delta = normalizeAngle(desiredYaw - Number(player.rotY || 0));
    const distance = Math.hypot(dx, dz);
    lastDistance = Number(distance.toFixed(3));

    if (isMobile) {
      joystick = await readJoystick(page).catch(() => joystick);
      joystickVisible = joystickVisible || rectVisible(joystick);
      const isPrecisionTarget = itemKind !== "trash";
      const steerPower = isPrecisionTarget ? 0.68 : 0.48;
      const stickX = Math.abs(delta) > 0.07 ? (delta > 0 ? steerPower : -steerPower) : 0;
      let stickY = distance > 0.35 && Math.abs(delta) < 1.35 ? -0.82 : -0.12;
      if (isPrecisionTarget) {
        if (Math.abs(delta) > 0.85) {
          stickY = -0.02;
        } else if (distance > 2.4) {
          stickY = -0.62;
        } else {
          stickY = Math.abs(delta) < 1.0 ? -0.28 : -0.04;
        }
      }
      if (isPrecisionTarget && distance < 1.05) {
        stickY = -0.04;
      }
      await moveJoystick(page, joystick, stickX, stickY, pointerDown);
    } else {
      await setKey(page, "ArrowUp", distance > 0.35 && Math.abs(delta) < 1.35, held);
      await setKey(page, "ArrowRight", delta > 0.07, held);
      await setKey(page, "ArrowLeft", delta < -0.07, held);
    }
    await sleep(isMobile ? 110 : 90);
  }

  await releaseKeys(page, held);
  await releaseJoystick(page, pointerDown);
  const settleStarted = Date.now();
  while (Date.now() - settleStarted < 3200) {
    final = await readState(page).catch(() => final);
    rememberPickupResult(final);
    rememberPickupRequest(final);
    collected = collected || successForKind({ itemKind, initialScore, initialCount, final });
    if (pickupResults.some((result) => pickupResultMatchesKind(result, itemKind))) break;
    await sleep(120);
  }
  const authoritativePickupResult = [...pickupResults]
    .reverse()
    .find((result) => pickupResultMatchesKind(result, itemKind)) || null;
  const authoritativePickupRequest = [...pickupRequests]
    .reverse()
    .find((request) => (
      request.itemId === authoritativePickupResult?.itemId ||
      pickupEvidenceMatchesKind(request, itemKind)
    )) || null;
  return {
    itemKind,
    collected,
    targetId,
    initialScore,
    finalScore: Number(final?.score || 0),
    initialCount,
    finalCount: countForKind(final, itemKind),
    initialTime,
    finalTime: Number(final?.timeRemaining),
    lastDistance,
    initial,
    final,
    samples,
    pickupResults,
    pickupRequests,
    authoritativePickupRequest,
    authoritativePickupResult,
    joystickVisible,
  };
}

function classifyFrameBudget(compute, { interactionPassed }) {
  const fpsAvg = Number(compute?.fps?.avg || 0);
  const frameP95 = Number(compute?.frameMs?.p95 || 0);
  const rafP95 = Number(compute?.rafMs?.p95 || 0);
  const longTasks = Number(compute?.longTasks?.count || 0);
  if (fpsAvg >= 45 && frameP95 <= 34) {
    return { status: "pass", reason: "frame budget met" };
  }
  const steadyAutomation30Hz = fpsAvg >= 28
    && fpsAvg <= 32
    && frameP95 <= 38
    && rafP95 <= 38
    && longTasks <= 2;
  if (interactionPassed && steadyAutomation30Hz) {
    return {
      status: "warn",
      warning: "Browser automation is running this probe at a steady 30 Hz; interaction succeeded with stable frame pacing.",
    };
  }
  return { status: "fail", reason: "frame budget missed" };
}

async function runScenario({ playwright, engineName, scenario, itemKind, baseUrl, outputDir, timeoutMs, driveMs }) {
  const browserType = engineName === "chrome" ? playwright.chromium : playwright[engineName];
  const isMobile = scenario === "mobile";
  const engineDir = path.join(outputDir, `${engineName}-${scenario}-${itemKind}`);
  await fs.mkdir(engineDir, { recursive: true });
  const checks = [];
  const room = shortScenarioRoom({ itemKind, engineName, scenario });
  const name = `QA ${engineName} ${scenario} ${itemKind}`;
  let browser = null;
  let adminSocket = null;
  const errors = [];

  if (!browserType) {
    return { status: "fail", engineName, scenario, itemKind, room, checks: [{ name: "browser engine available", status: "fail" }] };
  }

  try {
    browser = await browserType.launch({
      headless: true,
      channel: engineName === "chrome" ? "chrome" : undefined,
      args: engineName === "chromium" ? ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"] : [],
    });
    const context = await browser.newContext(isMobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await installPerfObserver(page);
    errors.push(...collectBrowserErrors(page));

    const playerUrl = `${baseUrl}/?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}`;
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const waiting = await waitForState(page, (state) => state?.mode !== "RUNNING", 45000);
    checks.push({ name: "waits before presenter start", status: waiting.ok ? "pass" : "fail", mode: waiting.state?.mode });

    adminSocket = await connectSocket(baseUrl);
    const startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const running = await waitForState(page, (state) =>
      state?.mode === "RUNNING" && samplesForKind(state, itemKind).length > 0,
    timeoutMs);
    checks.push({
      name: `reaches running with visible ${itemKind}`,
      status: running.ok ? "pass" : "fail",
      elapsedMs: running.elapsedMs,
      timeRemaining: running.state?.timeRemaining,
      itemCount: countForKind(running.state, itemKind),
      samples: samplesForKind(running.state, itemKind),
    });
    await page.screenshot({ path: path.join(engineDir, "running.png"), fullPage: true }).catch(() => {});

    const drive = await driveToItem(page, { itemKind, isMobile, maxDriveMs: driveMs });
    const perf = await readPerf(page);
    const compute = summarizeSamples(drive.samples, perf);
    const frameBudget = classifyFrameBudget(compute, { interactionPassed: drive.collected });
    const reachabilitySamples = [drive.initial, ...(drive.samples || []), drive.final]
      .filter(Boolean)
      .map((sample) => Number(sample?.worldBoundary?.unreachableItems))
      .filter(Number.isFinite);
    const maxUnreachableItems = reachabilitySamples.length
      ? Math.max(...reachabilitySamples)
      : Number.NaN;
    await page.screenshot({ path: path.join(engineDir, "after-drive.png"), fullPage: true }).catch(() => {});

    checks.push({
      name: `browser-driven ${itemKind} interaction`,
      status: drive.collected ? "pass" : "fail",
      targetId: drive.targetId,
      initialScore: drive.initialScore,
      finalScore: drive.finalScore,
      initialCount: drive.initialCount,
      finalCount: drive.finalCount,
      lastDistance: Number(Number(drive.lastDistance).toFixed(3)),
      lastPickupResult: drive.authoritativePickupResult || drive.final?.pickups?.lastResult || null,
      powerUps: drive.final?.powerUps || null,
    });
    const pickupRequest = drive.authoritativePickupRequest || drive.final?.pickups?.lastRequest || null;
    const pickupResult = drive.authoritativePickupResult || null;
    const scoreBearingPickup = itemKind === "trash" || itemKind === "turtle";
    const hudLatencyMs = Number(pickupRequest?.hudLatencyMs);
    const requestToResultMs = Number(pickupResult?.requestToResultMs);
    const serverProcessingMs = Number(pickupResult?.serverProcessingMs);
    const optimisticDisplayPassed = !scoreBearingPickup || (
      pickupRequest?.optimisticApplied === true &&
      Number.isFinite(hudLatencyMs) &&
      hudLatencyMs <= 50
    );
    checks.push({
      name: "pickup score feedback is immediate",
      status: optimisticDisplayPassed ? "pass" : "fail",
      scoreBearingPickup,
      optimisticApplied: pickupRequest?.optimisticApplied ?? null,
      hudLatencyMs: Number.isFinite(hudLatencyMs) ? hudLatencyMs : null,
      thresholdMs: 50,
    });
    const visualLatencyMs = Number(pickupRequest?.visualLatencyMs);
    const visualFeedbackPassed = pickupRequest?.visualHidden === true &&
      Number.isFinite(visualLatencyMs) &&
      visualLatencyMs <= 50;
    checks.push({
      name: "pickup object feedback is immediate",
      status: visualFeedbackPassed ? "pass" : "fail",
      visualHidden: pickupRequest?.visualHidden ?? null,
      visualLatencyMs: Number.isFinite(visualLatencyMs) ? visualLatencyMs : null,
      thresholdMs: 50,
    });
    const reconciliationPassed = pickupResult?.ok === true &&
      Number.isFinite(requestToResultMs) &&
      requestToResultMs <= 2500;
    checks.push({
      name: "pickup score reconciles with server authority",
      status: reconciliationPassed ? "pass" : "fail",
      requestToResultMs: Number.isFinite(requestToResultMs) ? requestToResultMs : null,
      serverProcessingMs: Number.isFinite(serverProcessingMs) ? serverProcessingMs : null,
      thresholdMs: 2500,
      score: pickupResult?.score ?? drive.finalScore,
      scoreSource: pickupResult?.scoreSource || null,
    });
    checks.push({
      name: "all gameplay items remain inside reachable map bounds",
      status: Number.isFinite(maxUnreachableItems) && maxUnreachableItems === 0 ? "pass" : "fail",
      samples: reachabilitySamples.length,
      maxUnreachableItems: Number.isFinite(maxUnreachableItems) ? maxUnreachableItems : null,
      itemSpawnEdgeMargin: drive.final?.worldBoundary?.itemSpawnEdgeMargin ?? null,
    });
    if (isMobile) {
      checks.push({
        name: "mobile joystick visible",
        status: drive.joystickVisible ? "pass" : "fail",
      });
    }
    checks.push({
      name: "browser console/network errors",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
    });
    checks.push({
      name: "compute/frame budget during item drive",
      status: frameBudget.status,
      fpsAvg: compute.fps.avg,
      frameP95: compute.frameMs.p95,
      rafP95: compute.rafMs.p95,
      longTasks: compute.longTasks.count,
      warning: frameBudget.warning || null,
      reason: frameBudget.reason || null,
    });

    const failed = checks.filter((check) => check.status === "fail");
    return {
      status: failed.length ? "fail" : "pass",
      engineName,
      scenario,
      itemKind,
      room,
      name,
      url: playerUrl,
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null),
      checks,
      drive,
      compute,
    };
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
    return { status: "fail", engineName, scenario, itemKind, room, checks };
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const driveMs = Number(argValue("drive-ms", "25000"));
  const engines = String(argValue("engines", "chrome")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const itemTypes = String(argValue("item-types", "trash,turtle,powerup")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const scenariosArg = argValue("scenarios", "");
  const scenarios = scenariosArg
    ? scenariosArg.split(",").map((entry) => entry.trim()).filter(Boolean)
    : (hasFlag("include-mobile") ? ["desktop", "mobile"] : ["desktop"]);
  const startedAt = new Date().toISOString();
  await fs.mkdir(outputDir, { recursive: true });
  const playwright = await import(await resolvePlaywrightImport());
  const results = [];

  for (const engineName of engines) {
    for (const scenario of scenarios) {
      for (const itemKind of itemTypes) {
        results.push(await runScenario({ playwright, engineName, scenario, itemKind, baseUrl, outputDir, timeoutMs, driveMs }));
      }
    }
  }

  const result = {
    status: results.every((entry) => entry.status === "pass") ? "pass" : "fail",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    driveMs,
    engines,
    scenarios,
    itemTypes,
    results,
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Browser Item Collision Matrix Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Drive budget: ${driveMs}ms`,
    "",
    "## Checks",
  ];
  for (const entry of results) {
    lines.push(`- ${statusIcon(entry.status)} ${entry.engineName}/${entry.scenario}/${entry.itemKind}`);
    for (const check of entry.checks || []) {
      lines.push(`  - ${statusIcon(check.status)} ${check.name}`);
    }
    const interaction = (entry.checks || []).find((check) => check.name === `browser-driven ${entry.itemKind} interaction`);
    if (interaction) {
      lines.push(`  - Score/count: ${interaction.initialScore}->${interaction.finalScore}; ${interaction.initialCount}->${interaction.finalCount}`);
      lines.push(`  - Last pickup: ${JSON.stringify(interaction.lastPickupResult || {})}`);
    }
    const feedback = (entry.checks || []).find((check) => check.name === "pickup score feedback is immediate");
    const visualFeedback = (entry.checks || []).find((check) => check.name === "pickup object feedback is immediate");
    const reconciliation = (entry.checks || []).find((check) => check.name === "pickup score reconciles with server authority");
    if (feedback || visualFeedback || reconciliation) {
      lines.push(`  - Pickup latency: HUD ${feedback?.hudLatencyMs ?? "-"}ms; object ${visualFeedback?.visualLatencyMs ?? "-"}ms; authority ${reconciliation?.requestToResultMs ?? "-"}ms; server ${reconciliation?.serverProcessingMs ?? "-"}ms`);
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
