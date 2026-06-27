#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "lobby-admin-timer-probe");

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

function emitAck(socket, event, payload, timeoutMs = 4000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, timeout: true, error: error.message || String(error) });
      else resolve(response);
    });
  });
}

function summarizeEvent(event, payload) {
  if (event === "game.state") return { state: payload };
  if (event === "room.joined") return payload;
  if (event === "room.admin") return payload;
  if (event === "startingGame") {
    return { startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null };
  }
  if (event === "game.time") return { remaining: payload };
  if (event === "game.on") return { startPosition: payload?.startPosition || null };
  if (event === "game.end") return payload || {};
  if (event === "server.info") {
    return {
      gameDuration: payload?.gameDuration,
      serverAuthEnabled: payload?.serverAuthEnabled,
      started: payload?.started,
    };
  }
  return undefined;
}

function createClient({ baseUrl, room, id, name }) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: false,
    timeout: 10000,
  });
  const client = {
    id,
    name,
    socket,
    connected: false,
    roomJoined: null,
    roomAdmin: null,
    serverInfo: null,
    states: [],
    countdowns: [],
    gameOn: [],
    gameTimes: [],
    gameEnds: [],
    events: [],
    errors: [],
  };

  socket.on("connect", () => { client.connected = true; });
  socket.on("connect_error", (error) => client.errors.push({ event: "connect_error", error: error.message || String(error) }));
  socket.onAny((event, payload) => {
    const summary = summarizeEvent(event, payload);
    if (summary !== undefined) {
      client.events.push({ at: Date.now(), event, summary });
      if (client.events.length > 160) client.events.shift();
    }
  });
  socket.on("room.joined", (payload) => { client.roomJoined = payload || {}; });
  socket.on("room.admin", (payload) => { client.roomAdmin = payload || {}; });
  socket.on("server.info", (payload) => { client.serverInfo = payload || {}; });
  socket.on("game.state", (payload) => client.states.push({ at: Date.now(), state: String(payload || "") }));
  socket.on("startingGame", (payload) => client.countdowns.push({ at: Date.now(), startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null }));
  socket.on("game.on", (payload) => client.gameOn.push({ at: Date.now(), startPosition: payload?.startPosition || null }));
  socket.on("game.time", (payload) => client.gameTimes.push({ at: Date.now(), remaining: Number(payload) }));
  socket.on("game.end", (payload) => client.gameEnds.push({ at: Date.now(), payload: payload || {} }));

  client.join = async () => {
    const clientSessionId = `${id}-session-${Date.now()}`;
    socket.emit("player.info.joining", { id, name, room, clientSessionId });
    socket.emit("room.join", { id: room });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && client.roomJoined?.id !== room) {
      socket.emit("player.info.joining", { id, name, room, clientSessionId });
      socket.emit("room.join", { id: room });
      await sleep(500);
    }
  };

  client.close = async () => {
    try { socket.disconnect(); } catch (_) {}
  };

  return client;
}

async function waitForConnected(client, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !client.connected) await sleep(100);
  return client.connected;
}

async function waitFor(client, predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(client)) return true;
    await sleep(intervalMs);
  }
  return predicate(client);
}

function latestState(client) {
  return client.states[client.states.length - 1]?.state || "UNKNOWN";
}

function timerSkew(a, b) {
  const pairs = [];
  for (const sampleA of a.gameTimes) {
    const sampleB = b.gameTimes.reduce((best, candidate) => {
      const delta = Math.abs(candidate.at - sampleA.at);
      if (!best || delta < best.delta) return { delta, sample: candidate };
      return best;
    }, null);
    if (sampleB && sampleB.delta <= 750) {
      pairs.push({
        atDeltaMs: sampleB.delta,
        a: sampleA.remaining,
        b: sampleB.sample.remaining,
        skewSeconds: Math.abs(Number(sampleA.remaining) - Number(sampleB.sample.remaining)),
      });
    }
  }
  const maxSkewSeconds = pairs.reduce((max, pair) => Math.max(max, pair.skewSeconds), 0);
  return { pairs: pairs.slice(0, 12), pairCount: pairs.length, maxSkewSeconds };
}

function firstTimerAfterGameOn(client) {
  const firstGameOnAt = client.gameOn[0]?.at || null;
  if (!firstGameOnAt) return null;
  return client.gameTimes.find((sample) => sample.at >= firstGameOnAt) || null;
}

function makeClientSummary(client) {
  return {
    id: client.id,
    name: client.name,
    connected: client.connected,
    roomJoined: client.roomJoined,
    roomAdmin: client.roomAdmin,
    latestState: latestState(client),
    serverInfo: client.serverInfo ? {
      gameDuration: client.serverInfo.gameDuration,
      serverAuthEnabled: client.serverInfo.serverAuthEnabled,
      started: client.serverInfo.started,
    } : null,
    states: client.states,
    countdowns: client.countdowns,
    gameOn: client.gameOn,
    gameTimes: client.gameTimes.slice(0, 80),
    gameEnds: client.gameEnds,
    errors: client.errors,
    events: client.events,
  };
}

function selectAdminPair(admin, player) {
  const announcedAdminId = player.roomAdmin?.id || admin.roomAdmin?.id || null;
  if (announcedAdminId === admin.id) return { actualAdmin: admin, actualNonAdmin: player, announcedAdminId };
  if (announcedAdminId === player.id) return { actualAdmin: player, actualNonAdmin: admin, announcedAdminId };
  return { actualAdmin: admin, actualNonAdmin: player, announcedAdminId };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const preStartMs = Number(argValue("pre-start-ms", "3000"));
  const waitGameOver = hasFlag("wait-game-over");
  const room = argValue("room", `QA-TIMER-${Date.now().toString().slice(-6)}`);
  const startedAt = new Date().toISOString();
  const admin = createClient({ baseUrl, room, id: `qa-admin-${Date.now()}`, name: "QATimerAdmin" });
  const player = createClient({ baseUrl, room, id: `qa-player-${Date.now()}`, name: "QATimerPlayer" });
  const checks = [];
  let nonAdminAck = null;
  let adminAck = null;
  let duplicateStartAck = null;
  let endAck = null;

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const connected = await Promise.all([waitForConnected(admin), waitForConnected(player)]);
    checks.push({ name: "both sockets connected", status: connected.every(Boolean) ? "pass" : "fail", connected });

    await admin.join();
    await player.join();
    checks.push({
      name: "both clients joined target room",
      status: admin.roomJoined?.id === room && player.roomJoined?.id === room ? "pass" : "fail",
      adminRoomJoined: admin.roomJoined,
      playerRoomJoined: player.roomJoined,
    });

    await sleep(preStartMs);
    const adminPair = selectAdminPair(admin, player);
    const actualAdmin = adminPair.actualAdmin;
    const actualNonAdmin = adminPair.actualNonAdmin;
    checks.push({
      name: "room admin is announced",
      status: adminPair.announcedAdminId ? "pass" : "fail",
      announcedAdminId: adminPair.announcedAdminId,
      actualAdmin: actualAdmin.id,
      actualNonAdmin: actualNonAdmin.id,
      adminClientSaw: admin.roomAdmin,
      playerClientSaw: player.roomAdmin,
    });

    const preStartGameOnCount = admin.gameOn.length + player.gameOn.length;
    const preStartRunning = [latestState(admin), latestState(player)].includes("RUNNING");
    checks.push({
      name: "room stays waiting before admin start",
      status: preStartGameOnCount === 0 && !preStartRunning ? "pass" : "fail",
      preStartMs,
      adminLatestState: latestState(admin),
      playerLatestState: latestState(player),
      preStartGameOnCount,
    });

    nonAdminAck = await emitAck(actualNonAdmin.socket, "admin.start", { cmdId: `non-admin-${Date.now()}` }, 5000);
    checks.push({
      name: "non-admin cannot start room",
      status: nonAdminAck?.ok === false && nonAdminAck?.error === "not_admin" ? "pass" : "fail",
      attemptedBy: actualNonAdmin.id,
      announcedAdminId: adminPair.announcedAdminId,
      ack: nonAdminAck,
    });

    adminAck = nonAdminAck?.ok === true
      ? nonAdminAck
      : await emitAck(actualAdmin.socket, "admin.start", { cmdId: `admin-${Date.now()}` }, 5000);
    checks.push({
      name: "admin starts room",
      status: adminAck?.ok === true && adminAck?.state === "STARTING" ? "pass" : "fail",
      attemptedBy: nonAdminAck?.ok === true ? actualNonAdmin.id : actualAdmin.id,
      ack: adminAck,
    });

    duplicateStartAck = await emitAck(actualAdmin.socket, "admin.start", { cmdId: `duplicate-start-${Date.now()}` }, 5000);
    checks.push({
      name: "duplicate start while starting is rejected",
      status: duplicateStartAck?.ok === false && duplicateStartAck?.error === "invalid_state" ? "pass" : "fail",
      attemptedBy: actualAdmin.id,
      ack: duplicateStartAck,
    });

    await Promise.all([
      waitFor(admin, (client) => client.countdowns.length > 0, 5000),
      waitFor(player, (client) => client.countdowns.length > 0, 5000),
    ]);
    const adminCountdown = admin.countdowns[admin.countdowns.length - 1] || null;
    const playerCountdown = player.countdowns[player.countdowns.length - 1] || null;
    const countdownSkewMs = Math.abs(Number(adminCountdown?.startsAt || 0) - Number(playerCountdown?.startsAt || 0));
    checks.push({
      name: "shared server countdown",
      status: adminCountdown && playerCountdown && countdownSkewMs <= 250 ? "pass" : "fail",
      adminCountdown,
      playerCountdown,
      countdownSkewMs,
    });

    await Promise.all([
      waitFor(admin, (client) => client.gameOn.length > 0 && latestState(client) === "RUNNING", 18000),
      waitFor(player, (client) => client.gameOn.length > 0 && latestState(client) === "RUNNING", 18000),
    ]);
    checks.push({
      name: "both clients enter running",
      status: admin.gameOn.length > 0 && player.gameOn.length > 0 && latestState(admin) === "RUNNING" && latestState(player) === "RUNNING" ? "pass" : "fail",
      adminLatestState: latestState(admin),
      playerLatestState: latestState(player),
      adminGameOn: admin.gameOn[admin.gameOn.length - 1] || null,
      playerGameOn: player.gameOn[player.gameOn.length - 1] || null,
    });

    await Promise.all([
      waitFor(admin, (client) => client.gameTimes.length >= 3, 5000),
      waitFor(player, (client) => client.gameTimes.length >= 3, 5000),
    ]);
    const skew = timerSkew(admin, player);
    const durationValues = [admin.serverInfo?.gameDuration, player.serverInfo?.gameDuration].filter((value) => value != null);
    const adminFirstAfterRun = firstTimerAfterGameOn(admin);
    const playerFirstAfterRun = firstTimerAfterGameOn(player);
    const firstRunTimes = [adminFirstAfterRun?.remaining, playerFirstAfterRun?.remaining]
      .filter((value) => Number.isFinite(Number(value)))
      .map(Number);
    checks.push({
      name: "server canonical 60s timer",
      status: durationValues.every((value) => Number(value) === 60)
        && admin.gameTimes.length >= 3
        && player.gameTimes.length >= 3
        && skew.maxSkewSeconds <= 1
        && firstRunTimes.length === 2
        && firstRunTimes.every((value) => value >= 57 && value <= 60)
        ? "pass"
        : "fail",
      durationValues,
      adminFirstAfterRun,
      playerFirstAfterRun,
      adminFirstTimes: admin.gameTimes.slice(0, 5),
      playerFirstTimes: player.gameTimes.slice(0, 5),
      timerSkew: skew,
    });

    if (waitGameOver) {
      await Promise.all([
        waitFor(admin, (client) => client.gameEnds.length > 0 || latestState(client) === "ENDED" || latestState(client) === "WAITING", timeoutMs),
        waitFor(player, (client) => client.gameEnds.length > 0 || latestState(client) === "ENDED" || latestState(client) === "WAITING", timeoutMs),
      ]);
      checks.push({
        name: "both clients observe match end",
        status: admin.gameEnds.length > 0 && player.gameEnds.length > 0 ? "pass" : "fail",
        adminEnds: admin.gameEnds,
        playerEnds: player.gameEnds,
        adminLatestState: latestState(admin),
        playerLatestState: latestState(player),
      });
    } else {
      endAck = await emitAck(admin.socket, "admin.end", { cmdId: `admin-end-${Date.now()}` }, 5000);
      checks.push({
        name: "admin can end room after timer sample",
        status: endAck?.ok === true ? "pass" : "fail",
        ack: endAck,
      });
    }

    const failed = checks.filter((check) => check.status === "fail");
    const result = {
      status: failed.length === 0 ? "pass" : "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      waitGameOver,
      checks,
      nonAdminAck,
      adminAck,
      duplicateStartAck,
      endAck,
      clients: {
        admin: makeClientSummary(admin),
        player: makeClientSummary(player),
      },
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    const lines = [
      "# Lobby/Admin Timer Probe",
      "",
      `- Status: ${statusIcon(result.status)}`,
      `- Base URL: \`${baseUrl}\``,
      `- Room: \`${room}\``,
      `- Waited game-over: ${waitGameOver ? "yes" : "no"}`,
      "",
      "## Checks",
      ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
    ];
    await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
    if (failed.length > 0) process.exitCode = 1;
  } catch (error) {
    const result = {
      status: "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      error: error?.stack || error?.message || String(error),
      checks,
      clients: {
        admin: makeClientSummary(admin),
        player: makeClientSummary(player),
      },
    };
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "latest.md"), `# Lobby/Admin Timer Probe\n\n- Status: FAIL\n- Error: ${String(error?.message || error)}\n`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await Promise.all([admin.close(), player.close()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
