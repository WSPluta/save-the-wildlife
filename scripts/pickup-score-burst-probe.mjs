#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "pickup-score-burst-probe");

function argValue(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const equals = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return equals ? equals.slice(flag.length + 1) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitAck(socket, event, payload, timeoutMs = 7000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      const roundTripMs = Date.now() - startedAt;
      if (error) {
        resolve({ ok: false, error: error.message || String(error), timeout: true, roundTripMs });
        return;
      }
      resolve({ ...(response || { ok: true }), roundTripMs });
    });
  });
}

async function waitFor(predicate, timeoutMs = 30000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return !!predicate();
}

function itemPosition(item = {}) {
  const position = item.position || {};
  return {
    x: Number(position.x || 0),
    y: Number(position.y || 0),
    z: Number(position.z || 0),
  };
}

async function main() {
  const baseUrl = String(argValue("base-url", DEFAULT_BASE_URL)).replace(/\/+$/, "");
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-SCORE-BURST-${suffix}`);
  const playerId = `qa-score-burst-${suffix}`;
  const playerName = `QA Score Burst ${suffix}`;
  const checks = [];
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: false,
    timeout: 10000,
  });
  let connected = false;
  let joinedRoom = null;
  let gameOn = null;
  let latestItems = {};
  let gameEnd = null;
  let serverInfo = null;

  socket.on("connect", () => { connected = true; });
  socket.on("server.info", (payload) => { serverInfo = payload || null; });
  socket.on("room.joined", (payload) => { joinedRoom = payload?.id || null; });
  socket.on("game.on", (payload) => { gameOn = payload || {}; });
  socket.on("items.all", (payload) => {
    latestItems = payload?.items && typeof payload.items === "object" ? payload.items : (payload || {});
  });
  socket.on("item.new", (payload) => {
    const id = payload?.id || payload?.itemId;
    const item = payload?.data || payload?.item;
    if (id && item) latestItems[id] = item;
  });
  socket.on("item.destroy", (payload) => {
    const id = payload?.id || payload?.itemId;
    if (id) delete latestItems[id];
  });
  socket.on("game.end", (payload) => { gameEnd = payload || {}; });

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const didConnect = await waitFor(() => connected, 12000);
    checks.push({ name: "socket connects", status: didConnect ? "pass" : "fail" });

    const clientSessionId = `${playerId}-session`;
    const joinDeadline = Date.now() + 12000;
    while (Date.now() < joinDeadline && joinedRoom !== room) {
      socket.emit("player.info.joining", { id: playerId, name: playerName, room, clientSessionId });
      socket.emit("room.join", { id: room });
      await sleep(300);
    }
    checks.push({ name: "player joins room", status: joinedRoom === room ? "pass" : "fail", joinedRoom });

    const startAck = await emitAck(socket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "presenter start accepted", status: startAck.ok === true ? "pass" : "fail", ack: startAck });
    const running = await waitFor(() => !!gameOn, 30000);
    checks.push({ name: "match reaches game.on", status: running ? "pass" : "fail" });
    await waitFor(() => Object.values(latestItems).filter((item) => item?.type === "trash").length >= 3, 10000);

    const trash = Object.entries(latestItems)
      .filter(([, item]) => item?.type === "trash")
      .slice(0, 3)
      .map(([id, item]) => ({ id, item, position: itemPosition(item) }));
    checks.push({ name: "three trash items available", status: trash.length === 3 ? "pass" : "fail", count: trash.length });

    const attemptedAt = Date.now();
    const acknowledgements = await Promise.all(trash.map(({ id, position }, index) => emitAck(socket, "items.collision", {
      itemId: id,
      playerId,
      playerName,
      requestId: `${playerId}:${index}:${attemptedAt}`,
      clientRequestedAt: attemptedAt,
      clientPosition: position,
      clientItemPosition: position,
    })));
    const scores = acknowledgements.map((ack) => Number(ack.score)).filter(Number.isFinite).sort((a, b) => a - b);
    const expectedScores = [1, 2, 3];
    checks.push({
      name: "concurrent pickups preserve every score increment",
      status: acknowledgements.every((ack) => ack.ok === true) && JSON.stringify(scores) === JSON.stringify(expectedScores) ? "pass" : "fail",
      expectedScores,
      scores,
      acknowledgements,
    });

    const endAck = await emitAck(socket, "admin.presenter.end", { room }, 8000);
    await waitFor(() => !!gameEnd, 10000);
    const finalScore = Number(gameEnd?.finalScores?.[playerId] ?? gameEnd?.scores?.[playerId]);
    checks.push({
      name: "game.end keeps the burst score canonical",
      status: endAck.ok === true && finalScore === 3 ? "pass" : "fail",
      endAck,
      finalScore: Number.isFinite(finalScore) ? finalScore : null,
      gameEnd,
    });

    const result = {
      status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
      baseUrl,
      room,
      playerId,
      serverInfo: serverInfo ? { id: serverInfo.id, version: serverInfo.version } : null,
      checks,
      generatedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    const lines = [
      "# Pickup Score Burst Probe",
      "",
      `- Status: ${result.status.toUpperCase()}`,
      `- Base URL: \`${baseUrl}\``,
      `- Room: \`${room}\``,
      `- Server: \`${result.serverInfo?.version || "unknown"}\``,
      "",
      "## Checks",
      ...checks.map((check) => `- ${check.status.toUpperCase()} ${check.name}`),
      "",
      `- Accepted score sequence: \`${scores.join(", ") || "none"}\``,
      `- Final score: \`${Number.isFinite(finalScore) ? finalScore : "missing"}\``,
    ];
    await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
    if (result.status !== "pass") process.exitCode = 1;
  } finally {
    try { socket.disconnect(); } catch (_) {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
