#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "commentary-result-probe");
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];

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

async function connectSocket(baseUrl, events) {
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
  socket.onAny((event, payload) => {
    if ([
      "room.joined",
      "room.admin",
      "game.state",
      "game.time",
      "game.on",
      "game.end",
      "commentary.pending",
      "commentary.ready",
    ].includes(event)) {
      events.push({ at: Date.now(), event, payload });
      if (events.length > 240) events.shift();
    }
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
    lobbyStatus: document.getElementById("lobby-status")?.textContent?.trim() || "",
    resultsScore: document.getElementById("results-score")?.textContent?.trim() || "",
    hudTime: document.getElementById("hud-time")?.textContent?.trim() || "",
    compactTime: document.getElementById("compact-time")?.textContent?.trim() || "",
  }));
}

async function snapshot(page) {
  const [state, dom] = await Promise.all([
    readState(page).catch(() => null),
    readDom(page).catch(() => ({})),
  ]);
  return { at: Date.now(), state, dom };
}

async function waitFor(page, predicate, timeoutMs, intervalMs = 250) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot(page);
    if (predicate(last.state, last.dom)) {
      return { ok: true, elapsedMs: Date.now() - started, ...last };
    }
    await sleep(intervalMs);
  }
  return { ok: false, elapsedMs: Date.now() - started, ...last };
}

function hasProfanity(text) {
  const lower = String(text || "").toLowerCase();
  return PROFANITY_BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function commentaryLooksPending(text) {
  return /draft|waiting|pending|commentary is being/i.test(String(text || ""));
}

function summarizeCommentaryPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    status: payload.status || null,
    source: payload.source || null,
    fallback_source: payload.fallback_source || null,
    model_id: payload.model_id || payload.modelId || payload.model_route?.primary?.model_id || null,
    runtime_mode: payload.runtime_mode || payload.model_route?.primary?.runtime_mode || null,
    trace_persisted: payload.trace_persisted ?? payload.model_route?.trace_persisted ?? null,
    score: payload.score ?? payload.summary?.score ?? null,
    line: payload.commentary || payload.line || null,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "150000"));
  const room = argValue("room", `QA-COMMENTARY-${Date.now().toString().slice(-6)}`);
  const name = argValue("name", `QA Commentary ${Date.now().toString().slice(-5)}`);
  const debug = hasFlag("debug");
  const startedAt = new Date().toISOString();
  const socketEvents = [];
  const checks = [];
  let commentaryPending = null;
  let commentaryReady = null;
  let monitorSocket = null;
  let adminSocket = null;
  let browser = null;
  let page = null;
  let playerUrl = null;
  let startAck = null;
  let runningStartedAt = null;
  const samples = {};

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const { chromium } = await import(await resolvePlaywrightImport());
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const browserErrors = collectBrowserErrors(page);

    monitorSocket = await connectSocket(baseUrl, socketEvents);
    monitorSocket.on("commentary.pending", (payload) => { commentaryPending = payload || {}; });
    monitorSocket.on("commentary.ready", (payload) => { commentaryReady = payload || {}; });
    const monitorJoin = await emitAck(monitorSocket, "room.join", { id: room }, 5000);
    checks.push({
      name: "monitor socket connects and subscribes",
      status: "pass",
      ack: monitorJoin,
    });

    playerUrl = `${baseUrl}/?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}${debug ? "&debug=1" : ""}`;
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
    samples.initial = await snapshot(page);
    await page.screenshot({ path: path.join(outputDir, "initial.png"), fullPage: true });

    const lobby = await waitFor(page, (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
    samples.lobby = lobby;
    checks.push({
      name: "player enters lobby before presenter start",
      status: lobby.ok ? "pass" : "fail",
      mode: lobby.state?.mode,
      bodyClass: lobby.dom?.bodyClass,
    });

    adminSocket = await connectSocket(baseUrl, socketEvents);
    startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({
      name: "presenter start accepted",
      status: startAck?.ok === true ? "pass" : "fail",
      ack: startAck,
    });

    const running = await waitFor(page, (state, dom) => state?.mode === "RUNNING" && dom.bodyClass.includes("phase-gameplay"), 30000);
    samples.running = running;
    runningStartedAt = running.ok ? Date.now() : null;
    await page.screenshot({ path: path.join(outputDir, "running.png"), fullPage: true });
    const initialRemaining = Number(running.state?.timeRemaining);
    checks.push({
      name: "player reaches running with 60s server timer",
      status: running.ok && initialRemaining >= 55 && initialRemaining <= 60 ? "pass" : "fail",
      elapsedMs: running.elapsedMs,
      initialRemaining,
      mode: running.state?.mode,
    });

    if (running.ok) {
      await page.keyboard.down("ArrowUp").catch(() => {});
      await page.keyboard.down("KeyD").catch(() => {});
      await sleep(900);
      samples.afterRight = await snapshot(page);
      await page.keyboard.up("KeyD").catch(() => {});
      await page.keyboard.down("KeyA").catch(() => {});
      await sleep(900);
      samples.afterLeft = await snapshot(page);
      await page.keyboard.up("KeyA").catch(() => {});
      await page.keyboard.up("ArrowUp").catch(() => {});
      await sleep(3500);
      samples.afterFiveSeconds = await snapshot(page);
      const remainingAfterFive = Number(samples.afterFiveSeconds.state?.timeRemaining);
      checks.push({
        name: "server timer ticks at real-time pace after start",
        status: remainingAfterFive <= initialRemaining - 2 && remainingAfterFive >= initialRemaining - 8 ? "pass" : "fail",
        initialRemaining,
        remainingAfterFive,
        realElapsedMs: samples.afterFiveSeconds.at - running.at,
      });
    }

    const postGame = await waitFor(page, (state, dom) => {
      return dom.bodyClass.includes("phase-post_game") || state?.mode === "ENDED";
    }, Math.max(80000, timeoutMs - 30000), 500);
    samples.postGame = postGame;
    await page.screenshot({ path: path.join(outputDir, "postgame-pending.png"), fullPage: true }).catch(() => {});
    const endedElapsedMs = runningStartedAt ? Date.now() - runningStartedAt : null;
    checks.push({
      name: "player reaches post-game near one-minute match end",
      status: postGame.ok && endedElapsedMs >= 52000 && endedElapsedMs <= 72000 ? "pass" : "fail",
      postGameOk: postGame.ok,
      endedElapsedMs,
      bodyClass: postGame.dom?.bodyClass,
      mode: postGame.state?.mode,
    });

    await sleep(13000);
    samples.afterRoomResetWindow = await snapshot(page);
    checks.push({
      name: "result card survives room reset window",
      status: String(samples.afterRoomResetWindow.dom?.bodyClass || "").includes("phase-post_game") ? "pass" : "fail",
      bodyClass: samples.afterRoomResetWindow.dom?.bodyClass,
      commentary: samples.afterRoomResetWindow.dom?.commentary,
    });

    const commentary = await waitFor(page, (_state, dom) => {
      const text = String(dom.commentary || "").trim();
      return text && !commentaryLooksPending(text);
    }, 90000, 500);
    samples.commentary = commentary;
    await page.screenshot({ path: path.join(outputDir, "postgame-ready.png"), fullPage: true }).catch(() => {});
    const commentaryText = String(commentary.dom?.commentary || "").trim();
    const commentarySource = String(commentaryReady?.source || "");
    checks.push({
      name: "result card receives final commentary",
      status: commentary.ok ? "pass" : "fail",
      elapsedMs: commentary.elapsedMs,
      text: commentaryText,
    });
    checks.push({
      name: "commentary is conference safe and bounded",
      status: commentaryText
        && commentaryText.length <= 200
        && !hasProfanity(commentaryText)
        && !commentaryLooksPending(commentaryText)
        ? "pass"
        : "fail",
      length: commentaryText.length,
      text: commentaryText,
    });
    checks.push({
      name: "commentary.ready arrives from non-deterministic route",
      status: commentaryReady
        && commentarySource
        && commentarySource !== "deterministic-fallback"
        && commentarySource !== "request-summary"
        ? "pass"
        : "fail",
      commentaryReady: summarizeCommentaryPayload(commentaryReady),
      commentaryPending: summarizeCommentaryPayload(commentaryPending),
    });

    checks.push({
      name: "browser errors",
      status: browserErrors.length === 0 ? "pass" : "fail",
      errors: browserErrors,
    });
  } catch (error) {
    checks.push({
      name: "probe fatal error",
      status: "fail",
      error: error?.stack || error?.message || String(error),
    });
  } finally {
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    try { if (monitorSocket) monitorSocket.disconnect(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
  }

  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length === 0 ? "pass" : "fail",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    name,
    playerUrl,
    startAck,
    checks,
    commentaryPending: summarizeCommentaryPayload(commentaryPending),
    commentaryReady: summarizeCommentaryPayload(commentaryReady),
    socketEvents,
    samples,
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Commentary Result Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
