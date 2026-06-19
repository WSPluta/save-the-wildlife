#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "conference-transport-smoke");

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

function makeCheck(name, status, details = {}) {
  return { name, status, ...details };
}

function finalVerdict(checks) {
  if (checks.some((check) => check.status === "fail")) return "failed";
  if (checks.some((check) => check.status === "warn")) return "ready_with_caveats";
  return "ready";
}

function compactError(error) {
  return error?.stack || error?.message || String(error || "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function emitAck(socket, event, payload, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function eventSummary(event, payload) {
  if (event === "items.all") {
    const values = Object.values(payload || {});
    return {
      count: values.length,
      trash: values.filter((item) => item && item.type !== "turtle" && !String(item.type || "").startsWith("powerup_")).length,
      turtles: values.filter((item) => item?.type === "turtle").length,
      powerups: values.filter((item) => String(item?.type || "").startsWith("powerup_")).length,
    };
  }
  if (event === "server.info") {
    return {
      gameDuration: payload?.gameDuration,
      started: payload?.started,
      serverAuthEnabled: payload?.serverAuthEnabled,
    };
  }
  if (event === "room.joined") return payload;
  if (event === "game.state") return { state: payload };
  if (event === "startingGame") return { countdownMs: payload?.countdownMs, startsAt: payload?.startsAt };
  if (event === "game.on") return { startPosition: payload?.startPosition };
  if (event === "game.time") return { remaining: payload };
  return undefined;
}

function itemCounts(items) {
  const values = Object.values(items || {});
  return {
    total: values.length,
    trash: values.filter((item) => item && item.type !== "turtle" && !String(item.type || "").startsWith("powerup_")).length,
    turtles: values.filter((item) => item?.type === "turtle").length,
    powerups: values.filter((item) => String(item?.type || "").startsWith("powerup_")).length,
  };
}

async function checkHttp(baseUrl, timeoutMs) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/`, { method: "HEAD" }, timeoutMs);
    return makeCheck(response.ok ? "http-game-url" : "http-game-url", response.ok ? "pass" : "fail", {
      statusCode: response.status,
      etag: response.headers.get("etag") || "",
      contentType: response.headers.get("content-type") || "",
    });
  } catch (error) {
    return makeCheck("http-game-url", "fail", { error: compactError(error) });
  }
}

async function runSocketLifecycle({ baseUrl, timeoutMs }) {
  const room = `STAGE-${Date.now().toString().slice(-8)}`;
  const playerId = `stage-transport-${Date.now()}`;
  const playerName = "Stage Transport Smoke";
  const events = [];
  const failures = [];
  let socket;
  let connectedAt = null;
  let roomJoined = null;
  let serverInfo = null;
  let gameState = "UNKNOWN";
  let startingGame = null;
  let gameOn = null;
  let gameTime = null;
  let startAck = null;
  let endAck = null;
  let items = {};

  function record(event, payload) {
    const summary = eventSummary(event, payload);
    if (summary !== undefined) events.push({ at: Date.now(), event, summary });
    if (events.length > 80) events.shift();
  }

  try {
    socket = io(baseUrl, {
      transports: ["polling", "websocket"],
      extraHeaders: {
        Origin: baseUrl,
      },
      reconnection: false,
      timeout: Math.min(timeoutMs, 10000),
    });

    socket.onAny(record);
    socket.on("server.info", (payload) => { serverInfo = payload || {}; });
    socket.on("room.joined", (payload) => { roomJoined = payload || {}; });
    socket.on("game.state", (payload) => { gameState = typeof payload === "string" ? payload : String(payload || ""); });
    socket.on("startingGame", (payload) => { startingGame = payload || {}; });
    socket.on("game.on", (payload) => {
      gameState = "RUNNING";
      gameOn = payload || {};
    });
    socket.on("game.time", (payload) => { gameTime = payload; });
    socket.on("items.all", (payload) => { items = { ...(payload || {}) }; });
    socket.on("item.new", (payload) => {
      const id = payload?.id || payload?.itemId;
      const data = payload?.data || payload?.item || null;
      if (id && data) items[id] = data;
    });
    socket.on("item.destroy", (payload) => {
      const id = payload?.id || payload?.itemId;
      if (id) delete items[id];
    });

    await new Promise((resolve, reject) => {
      socket.on("connect", () => {
        connectedAt = Date.now();
        resolve();
      });
      socket.on("connect_error", reject);
    });

    const clientSessionId = `stage-transport-${Date.now()}`;
    const joinDeadline = Date.now() + 12000;
    while (Date.now() < joinDeadline && roomJoined?.id !== room) {
      socket.emit("player.info.joining", {
        id: playerId,
        name: playerName,
        room,
        clientSessionId,
      });
      socket.emit("room.join", { id: room });
      await sleep(600);
    }
    if (roomJoined?.id !== room) failures.push(`room.joined not observed for ${room}`);
    if (failures.length) {
      return makeCheck("socket-room-lifecycle", "fail", {
        failures,
        baseUrl,
        room,
        playerId,
        connected: Boolean(connectedAt),
        roomJoined,
        itemCounts: itemCounts(items),
        events,
      });
    }

    startAck = await emitAck(socket, "admin.presenter.start", { room }, 4000).catch((error) => ({
      ok: false,
      error: error.message || String(error),
    }));
    if (!startAck?.ok) failures.push(`admin.presenter.start failed: ${JSON.stringify(startAck)}`);

    const runningDeadline = Date.now() + Math.min(timeoutMs, 60000);
    while (Date.now() < runningDeadline && gameState !== "RUNNING") await sleep(150);
    if (gameState !== "RUNNING") failures.push(`RUNNING not observed; state=${gameState}`);

    socket.emit("game.start", { playerId, playerName });

    const timerDeadline = Date.now() + 3500;
    while (Date.now() < timerDeadline && gameTime == null) await sleep(150);

    const itemsDeadline = Date.now() + 8000;
    while (Date.now() < itemsDeadline && itemCounts(items).trash < 4) await sleep(150);
    const counts = itemCounts(items);
    if (counts.total <= 0) failures.push("items were not observed");
    if (counts.trash < 4) failures.push(`expected at least 4 trash items, got ${counts.trash}`);
    if (counts.powerups < 1) failures.push(`expected at least 1 powerup item, got ${counts.powerups}`);
    if (!gameOn?.startPosition) failures.push("game.on startPosition not observed");
    if (gameTime == null || !Number.isFinite(Number(gameTime))) failures.push("game.time not observed");

    endAck = await emitAck(socket, "admin.presenter.end", { room }, 4000).catch((error) => ({
      ok: false,
      error: error.message || String(error),
    }));
    if (!endAck?.ok) failures.push(`admin.presenter.end failed: ${JSON.stringify(endAck)}`);

    return makeCheck("socket-room-lifecycle", failures.length ? "fail" : "pass", {
      failures,
      baseUrl,
      room,
      playerId,
      connected: Boolean(connectedAt),
      roomJoined,
      serverInfo: serverInfo ? {
        gameDuration: serverInfo.gameDuration,
        serverAuthEnabled: serverInfo.serverAuthEnabled,
        started: serverInfo.started,
      } : null,
      startAck,
      startingGame,
      gameOn,
      gameTime,
      itemCounts: counts,
      endAck,
      events,
    });
  } catch (error) {
    return makeCheck("socket-room-lifecycle", "fail", {
      failures: [compactError(error).split("\n")[0]],
      baseUrl,
      room,
      playerId,
      connected: Boolean(connectedAt),
      roomJoined,
      startAck,
      endAck,
      itemCounts: itemCounts(items),
      events,
      error: compactError(error),
    });
  } finally {
    if (socket) socket.disconnect();
  }
}

async function checkSocketLifecycleWithRetries({ baseUrl, timeoutMs, attempts }) {
  const results = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runSocketLifecycle({ baseUrl, timeoutMs });
    results.push(result);
    if (result.status === "pass") {
      if (attempt === 1) return result;
      return makeCheck("socket-room-lifecycle", "warn", {
        ...result,
        status: "warn",
        warnings: [`passed on attempt ${attempt} after ${attempt - 1} failed attempt(s)`],
        attempts: results.map((entry, index) => ({
          attempt: index + 1,
          status: entry.status,
          room: entry.room,
          failures: entry.failures || [],
          startAck: entry.startAck,
          gameOn: entry.gameOn,
          gameTime: entry.gameTime,
          itemCounts: entry.itemCounts,
        })),
      });
    }
    await sleep(1000);
  }
  const last = results[results.length - 1] || makeCheck("socket-room-lifecycle", "fail", {
    failures: ["no attempts executed"],
  });
  return makeCheck("socket-room-lifecycle", "fail", {
    ...last,
    status: "fail",
    failures: last.failures || ["socket lifecycle failed"],
    attempts: results.map((entry, index) => ({
      attempt: index + 1,
      status: entry.status,
      room: entry.room,
      failures: entry.failures || [],
      startAck: entry.startAck,
      gameOn: entry.gameOn,
      gameTime: entry.gameTime,
      itemCounts: entry.itemCounts,
    })),
  });
}

function renderCheckDetails(check) {
  const lines = [];
  if (check.statusCode) lines.push(`- Status: ${check.statusCode}`);
  if (check.etag) lines.push(`- ETag: ${check.etag}`);
  if (check.room) lines.push(`- Room: ${check.room}`);
  if (check.connected !== undefined) lines.push(`- Connected: ${check.connected ? "yes" : "no"}`);
  if (check.roomJoined) lines.push(`- Room joined: ${JSON.stringify(check.roomJoined)}`);
  if (check.startAck) lines.push(`- Start ack: ${JSON.stringify(check.startAck)}`);
  if (check.gameOn) lines.push(`- Game on: ${JSON.stringify(check.gameOn)}`);
  if (check.gameTime != null) lines.push(`- Game time: ${check.gameTime}`);
  if (check.itemCounts) lines.push(`- Items: ${JSON.stringify(check.itemCounts)}`);
  if (check.endAck) lines.push(`- End ack: ${JSON.stringify(check.endAck)}`);
  if (check.warnings?.length) {
    lines.push("- Warnings:");
    for (const warning of check.warnings) lines.push(`  - ${warning}`);
  }
  if (check.error) lines.push(`- Error: ${String(check.error).split("\n")[0]}`);
  if (check.failures?.length) {
    lines.push("- Failures:");
    for (const failure of check.failures) lines.push(`  - ${failure}`);
  }
  return lines;
}

function renderMarkdown(report) {
  const lines = [
    "# Save the Wildlife Conference Transport Smoke",
    "",
    `- Generated: ${report.generated_at}`,
    `- Base URL: ${report.base_url}`,
    `- Verdict: ${report.verdict}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`### ${statusIcon(check.status)} ${check.name}`);
    lines.push("");
    lines.push(...renderCheckDetails(check));
    lines.push("");
  }
  lines.push("## Presenter Reading");
  lines.push("");
  if (report.verdict === "failed") {
    lines.push("- Do not use this receipt as live transport proof. HTTP is reachable, but Socket.IO lifecycle failed in this run.");
    lines.push("- Use the failure details to troubleshoot transport, room join, or deployed room lifecycle behavior.");
  } else {
    lines.push("- Use this receipt to prove deployed HTTP and Socket.IO room lifecycle without launching a browser.");
    lines.push("- This does not replace the mobile/desktop visual smoke. It proves the public transport path when local Chromium is blocked.");
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", process.env.STWL_DEMO_BASE_URL || DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", process.env.STWL_CONFERENCE_TRANSPORT_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", process.env.STWL_DEMO_TIMEOUT_MS || "90000"));
  const attempts = Math.max(1, Number(argValue("attempts", process.env.STWL_TRANSPORT_ATTEMPTS || "3")));
  await fs.mkdir(outputDir, { recursive: true });

  const checks = [
    await checkHttp(baseUrl, timeoutMs),
    await checkSocketLifecycleWithRetries({ baseUrl, timeoutMs, attempts }),
  ];
  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    verdict: finalVerdict(checks),
    checks,
  };
  const jsonPath = path.join(outputDir, "latest.json");
  const mdPath = path.join(outputDir, "latest.md");
  const readyJsonPath = path.join(outputDir, "last-ready.json");
  const readyMdPath = path.join(outputDir, "last-ready.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(report), "utf8");
  if (report.verdict === "ready") {
    await fs.writeFile(readyJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(readyMdPath, renderMarkdown(report), "utf8");
  }

  for (const check of checks) console.log(`${statusIcon(check.status)} ${check.name}`);
  console.log(`verdict=${report.verdict}`);
  console.log(`json=${jsonPath}`);
  console.log(`summary=${mdPath}`);
  if (report.verdict === "ready") {
    console.log(`last_ready_json=${readyJsonPath}`);
    console.log(`last_ready_summary=${readyMdPath}`);
  }
  if (report.verdict === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
