#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "room-isolation-reconnect-probe");

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, timeout: true, error: error.message || String(error) });
      else resolve(response);
    });
  });
}

function itemSnapshotSummary(payload = {}, targetRoom) {
  const values = Object.values(payload || {});
  const rooms = Array.from(new Set(values.map((item) => item?.room || "missing"))).sort();
  const wrongRoomItems = values
    .filter((item) => item && item.room && item.room !== targetRoom)
    .slice(0, 8)
    .map((item) => ({ id: item.id || item.itemId || null, type: item.type || null, room: item.room }));
  return {
    count: values.length,
    rooms,
    wrongRoomCount: values.filter((item) => item && item.room && item.room !== targetRoom).length,
    missingRoomCount: values.filter((item) => item && !item.room).length,
    wrongRoomItems,
  };
}

function createClient({ baseUrl, id, name, room }) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: false,
    timeout: 10000,
  });
  const client = {
    id,
    name,
    room,
    socket,
    connected: false,
    joinedAt: null,
    roomJoined: null,
    roomAdmin: null,
    states: [],
    countdowns: [],
    gameOn: [],
    gameTimes: [],
    leftEvents: [],
    lobbySnapshots: [],
    itemSnapshots: [],
    errors: [],
    events: [],
  };

  function record(event, summary) {
    client.events.push({ at: Date.now(), event, summary });
    if (client.events.length > 220) client.events.shift();
  }

  socket.on("connect", () => {
    client.connected = true;
    record("connect", { id: socket.id });
  });
  socket.on("connect_error", (error) => client.errors.push({ type: "connect_error", text: error.message || String(error) }));
  socket.on("room.joined", (payload) => {
    client.roomJoined = payload || {};
    client.joinedAt = Date.now();
    record("room.joined", payload || {});
  });
  socket.on("room.admin", (payload) => {
    client.roomAdmin = payload || {};
    record("room.admin", payload || {});
  });
  socket.on("game.state", (payload) => {
    const entry = { at: Date.now(), state: String(payload || "") };
    client.states.push(entry);
    record("game.state", entry);
  });
  socket.on("startingGame", (payload) => {
    const entry = { at: Date.now(), startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null };
    client.countdowns.push(entry);
    record("startingGame", entry);
  });
  socket.on("game.on", (payload) => {
    const entry = { at: Date.now(), startPosition: payload?.startPosition || null };
    client.gameOn.push(entry);
    record("game.on", entry);
  });
  socket.on("game.time", (payload) => {
    const entry = { at: Date.now(), remaining: Number(payload) };
    client.gameTimes.push(entry);
    record("game.time", entry);
  });
  socket.on("player.info.left", (payload) => {
    const entry = { at: Date.now(), playerId: payload };
    client.leftEvents.push(entry);
    record("player.info.left", entry);
  });
  socket.on("lobby.players", (payload) => {
    const ids = Object.keys(payload || {});
    const entry = { at: Date.now(), ids };
    client.lobbySnapshots.push(entry);
    record("lobby.players", entry);
  });
  socket.on("player.info.all", (payload) => {
    const ids = Object.keys(payload || {});
    record("player.info.all", { ids });
  });
  socket.on("items.all", (payload) => {
    const entry = {
      at: Date.now(),
      afterJoin: Boolean(client.joinedAt),
      ...itemSnapshotSummary(payload, room),
    };
    client.itemSnapshots.push(entry);
    record("items.all", entry);
  });

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
  client.close = () => {
    try { socket.disconnect(); } catch (_) {}
  };
  return client;
}

async function waitForConnected(client, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !client.connected) await sleep(100);
  return client.connected;
}

async function waitFor(predicate, timeoutMs = 15000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function summarizeClient(client) {
  return {
    id: client.id,
    name: client.name,
    room: client.room,
    connected: client.connected,
    roomJoined: client.roomJoined,
    roomAdmin: client.roomAdmin,
    states: client.states,
    countdowns: client.countdowns,
    gameOn: client.gameOn,
    gameTimes: client.gameTimes.slice(0, 30),
    leftEvents: client.leftEvents,
    lobbySnapshots: client.lobbySnapshots.slice(-12),
    itemSnapshots: client.itemSnapshots,
    errors: client.errors,
    events: client.events,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const suffix = Date.now().toString().slice(-6);
  const roomA = argValue("room-a", `QA-ISO-A-${suffix}`);
  const roomB = argValue("room-b", `QA-ISO-B-${suffix}`);
  await fs.mkdir(outputDir, { recursive: true });

  const a1 = createClient({ baseUrl, id: `qa-iso-a1-${suffix}`, name: "QA Iso A1", room: roomA });
  const a2 = createClient({ baseUrl, id: `qa-iso-a2-${suffix}`, name: "QA Iso A2", room: roomA });
  const b1 = createClient({ baseUrl, id: `qa-iso-b1-${suffix}`, name: "QA Iso B1", room: roomB });
  const clients = [a1, a2, b1];
  const checks = [];
  let startAck = null;
  let endAck = null;
  let reconnect = null;

  try {
    const connected = await Promise.all(clients.map((client) => waitForConnected(client)));
    checks.push({ name: "all sockets connected", status: connected.every(Boolean) ? "pass" : "fail", connected });

    await Promise.all(clients.map((client) => client.join()));
    checks.push({
      name: "all clients joined target rooms",
      status: a1.roomJoined?.id === roomA && a2.roomJoined?.id === roomA && b1.roomJoined?.id === roomB ? "pass" : "fail",
      rooms: { a1: a1.roomJoined, a2: a2.roomJoined, b1: b1.roomJoined },
    });

    await sleep(1800);
    const preJoinLeaks = clients.flatMap((client) =>
      client.itemSnapshots
        .filter((snapshot) => !snapshot.afterJoin && snapshot.wrongRoomCount > 0)
        .map((snapshot) => ({ client: client.id, room: client.room, snapshot }))
    );
    checks.push({
      name: "no default-room item snapshot before target join",
      status: preJoinLeaks.length ? "fail" : "pass",
      leaks: preJoinLeaks.slice(0, 6),
    });

    const postJoinLeaks = clients.flatMap((client) =>
      client.itemSnapshots
        .filter((snapshot) => snapshot.afterJoin && snapshot.wrongRoomCount > 0)
        .map((snapshot) => ({ client: client.id, room: client.room, snapshot }))
    );
    checks.push({
      name: "post-join item snapshots are room scoped",
      status: postJoinLeaks.length ? "fail" : "pass",
      leaks: postJoinLeaks.slice(0, 6),
    });

    startAck = await emitAck(a1.socket, "admin.presenter.start", { room: roomA }, 5000);
    checks.push({
      name: "room A presenter start accepted",
      status: startAck?.ok === true ? "pass" : "fail",
      ack: startAck,
    });
    await waitFor(() => a1.gameOn.length > 0 && a2.gameOn.length > 0, 18000);
    await sleep(2500);
    checks.push({
      name: "room A clients enter running",
      status: a1.gameOn.length > 0 && a2.gameOn.length > 0 ? "pass" : "fail",
      a1GameOn: a1.gameOn,
      a2GameOn: a2.gameOn,
    });
    checks.push({
      name: "room B does not receive room A match events",
      status: b1.countdowns.length === 0 && b1.gameOn.length === 0 && !b1.states.some((entry) => ["STARTING", "RUNNING"].includes(entry.state)) ? "pass" : "fail",
      b1States: b1.states,
      b1Countdowns: b1.countdowns,
      b1GameOn: b1.gameOn,
    });

    a2.close();
    await sleep(1200);
    checks.push({
      name: "room A observes player leave",
      status: a1.leftEvents.some((event) => event.playerId === a2.id) ? "pass" : "fail",
      leftEvents: a1.leftEvents,
    });

    reconnect = createClient({ baseUrl, id: a2.id, name: "QA Iso A2 Reconnect", room: roomA });
    await waitForConnected(reconnect);
    await reconnect.join();
    await waitFor(() => reconnect.gameOn.length > 0 || reconnect.states.some((entry) => entry.state === "RUNNING"), 6000);
    checks.push({
      name: "reconnected room A player rehydrates running state",
      status: reconnect.roomJoined?.id === roomA && (reconnect.gameOn.length > 0 || reconnect.states.some((entry) => entry.state === "RUNNING")) ? "pass" : "fail",
      reconnect: summarizeClient(reconnect),
    });

    endAck = await emitAck(a1.socket, "admin.presenter.end", { room: roomA }, 5000);
    checks.push({
      name: "room A presenter end accepted",
      status: endAck?.ok === true ? "pass" : "fail",
      ack: endAck,
    });
  } finally {
    for (const client of [a1, a2, b1, reconnect].filter(Boolean)) client.close();
  }

  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length ? "fail" : "pass",
    generatedAt: new Date().toISOString(),
    baseUrl,
    roomA,
    roomB,
    checks,
    startAck,
    endAck,
    clients: {
      a1: summarizeClient(a1),
      a2: summarizeClient(a2),
      b1: summarizeClient(b1),
      reconnect: reconnect ? summarizeClient(reconnect) : null,
    },
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Room Isolation Reconnect Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room A: \`${roomA}\``,
    `- Room B: \`${roomB}\``,
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
