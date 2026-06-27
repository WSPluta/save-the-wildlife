#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "server-affinity-probe");

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
      else resolve(response || { ok: true });
    });
  });
}

function summarizeItem(item) {
  if (!item) return null;
  const pos = item.position || {};
  return {
    id: item.id || item.itemId || null,
    type: item.type || null,
    room: item.room || null,
    position: {
      x: Number(pos.x || 0),
      y: Number(pos.y || 0),
      z: Number(pos.z || 0),
    },
  };
}

function itemCounts(items = {}) {
  const values = Object.values(items || {});
  return {
    total: values.length,
    trash: values.filter((item) => item?.type === "trash").length,
    turtles: values.filter((item) => item?.type === "turtle").length,
    powerups: values.filter((item) => String(item?.type || "").startsWith("powerup")).length,
  };
}

function chooseCollisionItem(items = {}, preferredIndex = 0) {
  const values = Object.values(items || {}).map(summarizeItem).filter((item) => item?.id);
  const preferred = values.filter((item) => item.type === "trash");
  const fallback = preferred.length ? preferred : values;
  return fallback[preferredIndex % Math.max(1, fallback.length)] || null;
}

function summarizeEvent(event, payload) {
  if (event === "server.info") {
    return {
      id: payload?.id || null,
      version: payload?.version || null,
      gameDuration: payload?.gameDuration,
      serverAuthEnabled: payload?.serverAuthEnabled,
    };
  }
  if (event === "room.joined") return payload || {};
  if (event === "room.admin") return payload || {};
  if (event === "game.state") return { state: payload };
  if (event === "startingGame") {
    return { startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null };
  }
  if (event === "game.on") return { startPosition: payload?.startPosition || null };
  if (event === "game.time") return { remaining: payload };
  if (event === "items.all") return { count: Object.keys(payload || {}).length, counts: itemCounts(payload) };
  if (event === "item.destroy") return payload || {};
  if (event === "item.new") {
    return { id: payload?.id || payload?.itemId || null, type: payload?.data?.type || payload?.item?.type || null };
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
    room,
    socket,
    connected: false,
    socketId: null,
    connectedServerInfo: null,
    serverInfo: null,
    serverInfoEvents: [],
    roomJoined: null,
    roomAdmin: null,
    states: [],
    countdowns: [],
    gameOn: [],
    gameTimes: [],
    items: {},
    events: [],
    errors: [],
    collisionAck: null,
  };

  function record(event, payload) {
    const summary = summarizeEvent(event, payload);
    if (summary !== undefined) {
      client.events.push({ at: Date.now(), event, summary });
      if (client.events.length > 240) client.events.shift();
    }
  }

  socket.onAny(record);
  socket.on("connect", () => {
    client.connected = true;
    client.socketId = socket.id;
    record("connect", { socketId: socket.id });
  });
  socket.on("connect_error", (error) => {
    client.errors.push({ event: "connect_error", error: error.message || String(error) });
  });
  socket.on("server.info", (payload) => {
    const body = payload || {};
    if (!client.connectedServerInfo) client.connectedServerInfo = body;
    client.serverInfo = body;
    client.serverInfoEvents.push({ at: Date.now(), id: body.id || null, version: body.version || null });
    if (client.serverInfoEvents.length > 20) client.serverInfoEvents.shift();
  });
  socket.on("room.joined", (payload) => { client.roomJoined = payload || {}; });
  socket.on("room.admin", (payload) => { client.roomAdmin = payload || {}; });
  socket.on("game.state", (payload) => client.states.push({ at: Date.now(), state: String(payload || "") }));
  socket.on("startingGame", (payload) => {
    client.countdowns.push({ at: Date.now(), startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null });
  });
  socket.on("game.on", (payload) => client.gameOn.push({ at: Date.now(), startPosition: payload?.startPosition || null }));
  socket.on("game.time", (payload) => client.gameTimes.push({ at: Date.now(), remaining: Number(payload) }));
  socket.on("items.all", (payload) => { client.items = { ...(payload || {}) }; });
  socket.on("item.new", (payload) => {
    const idValue = payload?.id || payload?.itemId;
    const item = payload?.data || payload?.item || null;
    if (idValue && item) client.items[idValue] = item;
  });
  socket.on("item.destroy", (payload) => {
    const idValue = payload?.id || payload?.itemId;
    if (idValue) delete client.items[idValue];
  });

  client.join = async () => {
    const clientSessionId = `${id}-session-${Date.now()}`;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && client.roomJoined?.id !== room) {
      socket.emit("player.info.joining", { id, name, room, clientSessionId });
      socket.emit("room.join", { id: room });
      await sleep(500);
    }
    return client.roomJoined?.id === room;
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

async function waitForServerDiversity(clients, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = new Set(clients.map((client) => client.connectedServerInfo?.id).filter(Boolean));
    if (ids.size > 1) return ids;
    await sleep(250);
  }
  return new Set(clients.map((client) => client.connectedServerInfo?.id).filter(Boolean));
}

function latestState(client) {
  return client.states[client.states.length - 1]?.state || "UNKNOWN";
}

function summarizeClient(client) {
  return {
    id: client.id,
    name: client.name,
    room: client.room,
    connected: client.connected,
    socketId: client.socketId,
    connectedServerId: client.connectedServerInfo?.id || null,
    latestBroadcastServerId: client.serverInfo?.id || null,
    serverInfo: client.serverInfo ? {
      id: client.serverInfo.id,
      version: client.serverInfo.version,
      gameDuration: client.serverInfo.gameDuration,
      serverAuthEnabled: client.serverInfo.serverAuthEnabled,
    } : null,
    serverInfoEvents: client.serverInfoEvents,
    roomJoined: client.roomJoined,
    roomAdmin: client.roomAdmin,
    latestState: latestState(client),
    countdownCount: client.countdowns.length,
    gameOnCount: client.gameOn.length,
    latestGameTime: client.gameTimes[client.gameTimes.length - 1] || null,
    itemCounts: itemCounts(client.items),
    collisionAck: client.collisionAck,
    errors: client.errors,
    events: client.events,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const clientCount = Math.max(2, Number(argValue("clients", "8")) || 8);
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-AFFINITY-${suffix}`);
  const startedAt = new Date().toISOString();
  const clients = Array.from({ length: clientCount }, (_, idx) =>
    createClient({
      baseUrl,
      room,
      id: `qa-affinity-${idx + 1}-${suffix}`,
      name: `QA Affinity ${idx + 1}`,
    })
  );
  const checks = [];
  let startAck = null;
  let endAck = null;

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const connected = await Promise.all(clients.map((client) => waitForConnected(client)));
    checks.push({ name: "all sockets connected", status: connected.every(Boolean) ? "pass" : "fail", connected });

    const serverIds = await waitForServerDiversity(clients, 5000);
    checks.push({
      name: "server.info identity captured",
      status: serverIds.size >= 1 ? "pass" : "fail",
      serverIds: Array.from(serverIds).sort(),
      distinctServerCount: serverIds.size,
    });

    await Promise.all(clients.map((client) => client.join()));
    checks.push({
      name: "all clients joined target room",
      status: clients.every((client) => client.roomJoined?.id === room) ? "pass" : "fail",
      joined: clients.map((client) => ({
        id: client.id,
        roomJoined: client.roomJoined,
        connectedServerId: client.connectedServerInfo?.id || null,
        latestBroadcastServerId: client.serverInfo?.id || null,
      })),
    });

    const starter = clients[0];
    startAck = await emitAck(starter.socket, "admin.presenter.start", { room }, 8000);
    checks.push({
      name: "presenter start accepted",
      status: startAck?.ok === true ? "pass" : "fail",
      starter: {
        id: starter.id,
        connectedServerId: starter.connectedServerInfo?.id || null,
        latestBroadcastServerId: starter.serverInfo?.id || null,
      },
      ack: startAck,
    });

    await waitFor(() => clients.every((client) => client.gameOn.length > 0), Math.min(timeoutMs, 30000));
    checks.push({
      name: "all clients receive game.on",
      status: clients.every((client) => client.gameOn.length > 0) ? "pass" : "fail",
      gameOn: clients.map((client) => ({
        id: client.id,
        connectedServerId: client.connectedServerInfo?.id || null,
        latestBroadcastServerId: client.serverInfo?.id || null,
        count: client.gameOn.length,
        latestState: latestState(client),
        startPosition: client.gameOn[client.gameOn.length - 1]?.startPosition || null,
      })),
    });

    await waitFor(() => clients.every((client) => itemCounts(client.items).total > 0), 8000);
    await sleep(1000);
    const usedItemIds = new Set();
    for (let idx = 0; idx < clients.length; idx += 1) {
      const client = clients[idx];
      const available = Object.values(client.items || {})
        .map(summarizeItem)
        .filter((item) => item?.id && !usedItemIds.has(item.id));
      const item = available.find((entry) => entry.type === "trash") || chooseCollisionItem(client.items, idx);
      if (!item) {
        client.collisionAck = { ok: false, error: "no_item_available" };
        continue;
      }
      usedItemIds.add(item.id);
      client.collisionAck = await emitAck(client.socket, "items.collision", {
        itemId: item.id,
        playerId: client.id,
        playerName: client.name,
        clientPosition: item.position,
        clientItemPosition: item.position,
      }, 7000);
      client.collisionAck = {
        ...client.collisionAck,
        attemptedItem: item,
      };
      await sleep(350);
    }

    const collisionRows = clients.map((client) => ({
      id: client.id,
      connectedServerId: client.connectedServerInfo?.id || null,
      latestBroadcastServerId: client.serverInfo?.id || null,
      starterServer: client.connectedServerInfo?.id === starter.connectedServerInfo?.id,
      latestState: latestState(client),
      gameOnCount: client.gameOn.length,
      ack: client.collisionAck,
    }));
    const notRunningRows = collisionRows.filter((row) => row.ack?.error === "not_running");
    checks.push({
      name: "collision accepted after game.on",
      status: notRunningRows.length === 0 && collisionRows.some((row) => row.ack?.ok === true) ? "pass" : "fail",
      notRunningCount: notRunningRows.length,
      rows: collisionRows,
    });

    const byServer = new Map();
    for (const row of collisionRows) {
      const key = row.connectedServerId || "unknown";
      const bucket = byServer.get(key) || { serverId: key, ok: 0, notRunning: 0, otherFail: 0, total: 0 };
      bucket.total += 1;
      if (row.ack?.ok === true) bucket.ok += 1;
      else if (row.ack?.error === "not_running") bucket.notRunning += 1;
      else bucket.otherFail += 1;
      byServer.set(key, bucket);
    }
    checks.push({
      name: "collision outcome grouped by server id",
      status: "pass",
      starterConnectedServerId: starter.connectedServerInfo?.id || null,
      starterLatestBroadcastServerId: starter.serverInfo?.id || null,
      groups: Array.from(byServer.values()).sort((a, b) => String(a.serverId).localeCompare(String(b.serverId))),
    });

    endAck = await emitAck(starter.socket, "admin.presenter.end", { room }, 5000);
  } finally {
    for (const client of clients) client.close();
  }

  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length ? "fail" : "pass",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    clientCount,
    checks,
    startAck,
    endAck,
    clients: clients.map(summarizeClient),
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    "# Server Affinity Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Clients: ${clientCount}`,
    "",
    "## Checks",
  ];
  for (const check of checks) {
    lines.push(`- ${statusIcon(check.status)} ${check.name}`);
    if (check.name === "server.info identity captured") {
      lines.push(`  - Servers: ${(check.serverIds || []).join(", ") || "-"}`);
    }
    if (check.name === "collision accepted after game.on") {
      lines.push(`  - not_running: ${check.notRunningCount}`);
      for (const row of check.rows || []) {
        const ack = row.ack || {};
        lines.push(`  - ${row.id} on ${row.connectedServerId || "unknown"}: ok=${ack.ok === true}, error=${ack.error || "-"}, item=${ack.attemptedItem?.type || ack.itemType || "-"}`);
      }
    }
    if (check.name === "collision outcome grouped by server id") {
      for (const group of check.groups || []) {
        lines.push(`  - ${group.serverId}: ok=${group.ok}, not_running=${group.notRunning}, otherFail=${group.otherFail}, total=${group.total}`);
      }
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
