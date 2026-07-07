#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "mobile-flow-probe");

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
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

function collectBrowserErrors(page) {
  const errors = [];
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
    if (url.includes("/api/replay/events")) return;
    errors.push({ type: "http", status: response.status(), url });
  });
  return errors;
}

function emitAck(socket, event, payload, timeoutMs = 8000) {
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

async function readGameState(page) {
  return page.evaluate(() => {
    const render = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
    const state = render ? JSON.parse(render) : null;
    const rectFor = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    };
    return {
      state,
      bodyClass: document.body.className,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvas: rectFor("canvas"),
      joystick: rectFor("#touch-joystick"),
      compactHud: rectFor("#hud-compact"),
      hud: rectFor("#hud"),
      lobbyStatus: document.getElementById("lobby-status")?.textContent?.trim() || "",
    };
  });
}

async function waitForState(page, predicate, timeoutMs = 90000) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, {
    timeout: Math.max(timeoutMs, 120000),
  });
  await page.waitForFunction((predicateSource) => {
    try {
      const state = JSON.parse(window.render_game_to_text());
      const bodyClass = document.body.className;
      return Function("state", "bodyClass", `return (${predicateSource})(state, bodyClass);`)(state, bodyClass);
    } catch {
      return false;
    }
  }, predicate.toString(), { timeout: timeoutMs });
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

async function runLobbyNoAutostart({ browser, baseUrl, outputDir, timeoutMs }) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const errors = collectBrowserErrors(page);
  const room = `QA-MOBILE-LOBBY-${Date.now().toString().slice(-6)}`;
  await page.goto(`${baseUrl}/?name=QAMobileLobby&room=${room}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForState(page, () => true, timeoutMs);
  await page.waitForTimeout(5000);
  const snapshot = await readGameState(page);
  await page.screenshot({ path: path.join(outputDir, "mobile-no-autostart.png"), fullPage: true });
  await page.close();
  return {
    room,
    status: snapshot.state?.mode !== "RUNNING" && !snapshot.bodyClass.includes("phase-gameplay") ? "pass" : "fail",
    snapshot,
    errors,
  };
}

async function dragJoystick(page, joystickRect) {
  const startX = joystickRect.left + joystickRect.width / 2;
  const startY = joystickRect.top + joystickRect.height / 2;
  const endX = startX + joystickRect.width * 0.25;
  const endY = startY - joystickRect.height * 0.35;
  await page.touchscreen.tap(startX, startY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await page.waitForTimeout(1800);
}

async function runAutostartAndJoystick({ browser, baseUrl, outputDir, timeoutMs }) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const errors = collectBrowserErrors(page);
  const room = `QA-MOBILE-AUTO-${Date.now().toString().slice(-6)}`;
  let adminSocket = null;
  let startAck = null;
  await page.goto(`${baseUrl}/?name=QAMobileAuto&room=${room}&autostart=1`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForState(page, () => true, timeoutMs);
  await page.waitForTimeout(5000);
  const autostartBefore = await readGameState(page);
  await page.screenshot({ path: path.join(outputDir, "mobile-autostart-blocked.png"), fullPage: true });

  adminSocket = await connectSocket(baseUrl);
  startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
  await waitForState(page, (state) => state && state.mode === "RUNNING", timeoutMs);
  await page.waitForTimeout(1200);
  const runningBefore = await readGameState(page);
  await page.screenshot({ path: path.join(outputDir, "mobile-presenter-start-running.png"), fullPage: true });

  let afterDrag = null;
  let afterRelease = null;
  if (rectVisible(runningBefore.joystick)) {
    await dragJoystick(page, runningBefore.joystick);
    afterDrag = await readGameState(page);
    await page.waitForTimeout(2500);
    afterRelease = await readGameState(page);
  }
  await page.screenshot({ path: path.join(outputDir, "mobile-after-release.png"), fullPage: true });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await page.waitForTimeout(1800);
  const landscape = await readGameState(page);
  await page.screenshot({ path: path.join(outputDir, "mobile-landscape.png"), fullPage: true });
  try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
  await page.close();

  const moveDistance = afterDrag && runningBefore.state?.player && afterDrag.state?.player
    ? Math.hypot(
      Number(afterDrag.state.player.x || 0) - Number(runningBefore.state.player.x || 0),
      Number(afterDrag.state.player.z || 0) - Number(runningBefore.state.player.z || 0),
    )
    : 0;
  const releaseSpeed = Math.abs(Number(afterRelease?.state?.player?.speed || 0));
  const dragSpeed = Math.abs(Number(afterDrag?.state?.player?.speed || 0));

  return {
    room,
    startAck,
    autostartBefore,
    runningBefore,
    afterDrag,
    afterRelease,
    landscape,
    moveDistance: Number(moveDistance.toFixed(3)),
    dragSpeed: Number(dragSpeed.toFixed(3)),
    releaseSpeed: Number(releaseSpeed.toFixed(3)),
    errors,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  await fs.mkdir(outputDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const { chromium } = await import(await resolvePlaywrightImport());
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
  });
  const checks = [];
  let lobby;
  let auto;
  try {
    lobby = await runLobbyNoAutostart({ browser, baseUrl, outputDir, timeoutMs });
    auto = await runAutostartAndJoystick({ browser, baseUrl, outputDir, timeoutMs });
  } finally {
    await browser.close().catch(() => {});
  }

  checks.push({
    name: "mobile no-autostart stays out of gameplay",
    status: lobby.status,
    room: lobby.room,
    mode: lobby.snapshot.state?.mode,
    bodyClass: lobby.snapshot.bodyClass,
    lobbyStatus: lobby.snapshot.lobbyStatus,
  });
  checks.push({
    name: "public autostart query stays in lobby",
    status: auto.autostartBefore.state?.mode !== "RUNNING" && !auto.autostartBefore.bodyClass.includes("phase-gameplay") ? "pass" : "fail",
    room: auto.room,
    mode: auto.autostartBefore.state?.mode,
    bodyClass: auto.autostartBefore.bodyClass,
  });
  checks.push({
    name: "presenter start reaches running",
    status: auto.startAck?.ok === true && auto.runningBefore.state?.mode === "RUNNING" ? "pass" : "fail",
    room: auto.room,
    ack: auto.startAck,
    mode: auto.runningBefore.state?.mode,
    bodyClass: auto.runningBefore.bodyClass,
  });
  checks.push({
    name: "mobile joystick visible in portrait",
    status: rectVisible(auto.runningBefore.joystick) ? "pass" : "fail",
    joystick: auto.runningBefore.joystick,
  });
  checks.push({
    name: "mobile joystick does not overlap compact hud",
    status: !rectsOverlap(auto.runningBefore.joystick, auto.runningBefore.compactHud) ? "pass" : "fail",
    joystick: auto.runningBefore.joystick,
    compactHud: auto.runningBefore.compactHud,
  });
  checks.push({
    name: "mobile joystick moves boat",
    status: auto.moveDistance > 0.05 ? "pass" : "fail",
    moveDistance: auto.moveDistance,
    before: auto.runningBefore.state?.player,
    afterDrag: auto.afterDrag?.state?.player,
  });
  checks.push({
    name: "mobile touch release decelerates boat",
    status: auto.releaseSpeed < auto.dragSpeed ? "pass" : "fail",
    dragSpeed: auto.dragSpeed,
    releaseSpeed: auto.releaseSpeed,
    afterRelease: auto.afterRelease?.state?.player,
  });
  checks.push({
    name: "mobile landscape keeps joystick visible",
    status: rectVisible(auto.landscape.joystick) ? "pass" : "fail",
    joystick: auto.landscape.joystick,
    viewport: auto.landscape.viewport,
  });
  checks.push({
    name: "mobile landscape keeps hud and joystick separated",
    status: !rectsOverlap(auto.landscape.joystick, auto.landscape.compactHud) ? "pass" : "fail",
    joystick: auto.landscape.joystick,
    compactHud: auto.landscape.compactHud,
  });
  const browserErrors = [...(lobby.errors || []), ...(auto.errors || [])];
  checks.push({
    name: "mobile browser errors",
    status: browserErrors.length ? "fail" : "pass",
    errors: browserErrors,
  });

  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length ? "fail" : "pass",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    checks,
    lobby,
    auto,
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Mobile Flow Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
