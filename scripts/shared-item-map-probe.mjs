#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "shared-item-map-probe");

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : fallback;
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

async function waitFor(predicate, timeoutMs = 15000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function itemFromEnvelope(payload = {}) {
  return payload?.data || payload?.item || null;
}

function itemIdFromEnvelope(payload = {}) {
  return payload?.id || payload?.itemId || itemFromEnvelope(payload)?.id || null;
}

function summarizeItem(item = {}, fallbackId = "") {
  const pos = item.position || {};
  return {
    id: String(item.id || item.itemId || fallbackId || ""),
    type: String(item.type || ""),
    room: String(item.room || ""),
    x: Number(Number(pos.x || 0).toFixed(3)),
    y: Number(Number(pos.y || 0).toFixed(3)),
    z: Number(Number(pos.z || 0).toFixed(3)),
    size: Number(Number(item.size || 0).toFixed(3)),
  };
}

function itemCounts(items = {}) {
  const values = Object.values(items || {});
  return {
    total: values.length,
    trash: values.filter((item) => item?.type === "trash").length,
    turtles: values.filter((item) => item?.type === "turtle").length,
    powerups: values.filter((item) => String(item?.type || "").startsWith("powerup_")).length,
  };
}

function itemSignatures(items = {}) {
  return Object.entries(items || {})
    .map(([id, item]) => summarizeItem(item, id))
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function signatureKey(item) {
  return `${item.id}|${item.type}|${item.room}|${item.x}|${item.y}|${item.z}|${item.size}`;
}

function compareItemMaps(clients) {
  const signatures = clients.map((client) => itemSignatures(client.items));
  const baselineKeys = (signatures[0] || []).map(signatureKey);
  const mismatches = [];
  for (let i = 1; i < clients.length; i += 1) {
    const currentKeys = signatures[i].map(signatureKey);
    const missing = baselineKeys.filter((key) => !currentKeys.includes(key));
    const extra = currentKeys.filter((key) => !baselineKeys.includes(key));
    if (missing.length || extra.length) {
      mismatches.push({
        client: clients[i].name,
        missing: missing.slice(0, 8),
        extra: extra.slice(0, 8),
        baselineCount: baselineKeys.length,
        currentCount: currentKeys.length,
      });
    }
  }
  return {
    equal: mismatches.length === 0,
    counts: clients.map((client) => ({ name: client.name, ...itemCounts(client.items) })),
    baseline: (signatures[0] || []).slice(0, 12),
    mismatches,
  };
}

function commonIds(clients) {
  const sets = clients.map((client) => new Set(Object.keys(client.items || {})));
  if (!sets.length) return [];
  return [...sets[0]].filter((id) => sets.every((set) => set.has(id)));
}

function chooseCommonItem(clients, preferredType = "trash") {
  for (const id of commonIds(clients)) {
    const item = clients[0].items[id];
    if (item?.type === preferredType) return summarizeItem(item, id);
  }
  const ids = commonIds(clients);
  return ids.length ? summarizeItem(clients[0].items[ids[0]], ids[0]) : null;
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
    serverInfo: null,
    roomJoined: null,
    states: [],
    gameOn: [],
    gameTimes: [],
    items: {},
    itemAllCount: 0,
    itemNewEvents: [],
    itemDestroyEvents: [],
    errors: [],
  };

  socket.on("connect", () => {
    client.connected = true;
    client.socketId = socket.id;
  });
  socket.on("connect_error", (error) => {
    client.errors.push({ event: "connect_error", error: error.message || String(error) });
  });
  socket.on("server.info", (payload) => {
    client.serverInfo = payload || {};
  });
  socket.on("room.joined", (payload) => {
    client.roomJoined = payload || {};
  });
  socket.on("game.state", (payload) => {
    client.states.push({ at: Date.now(), state: String(payload || "") });
  });
  socket.on("game.on", (payload) => {
    client.gameOn.push({ at: Date.now(), startPosition: payload?.startPosition || null });
  });
  socket.on("game.time", (payload) => {
    client.gameTimes.push({ at: Date.now(), remaining: Number(payload) });
  });
  socket.on("items.all", (payload) => {
    client.items = { ...(payload || {}) };
    client.itemAllCount += 1;
  });
  socket.on("item.new", (payload) => {
    const idValue = itemIdFromEnvelope(payload);
    const item = itemFromEnvelope(payload);
    if (idValue && item) client.items[idValue] = item;
    client.itemNewEvents.push({ at: Date.now(), id: idValue, item: item ? summarizeItem(item, idValue) : null });
  });
  socket.on("item.destroy", (payload) => {
    const idValue = itemIdFromEnvelope(payload);
    if (idValue) delete client.items[idValue];
    client.itemDestroyEvents.push({ at: Date.now(), id: idValue, payload: payload || {} });
  });

  client.join = async () => {
    const clientSessionId = `${id}-session-${Date.now()}`;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && client.roomJoined?.id !== room) {
      socket.emit("player.info.joining", { id, name, room, clientSessionId });
      socket.emit("room.join", { id: room });
      await sleep(400);
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

function latestState(client) {
  return client.states[client.states.length - 1]?.state || "UNKNOWN";
}

function summarizeClient(client) {
  return {
    id: client.id,
    name: client.name,
    socketId: client.socketId,
    connectedServerId: client.serverInfo?.id || null,
    roomJoined: client.roomJoined,
    latestState: latestState(client),
    gameOnCount: client.gameOn.length,
    latestGameTime: client.gameTimes[client.gameTimes.length - 1] || null,
    itemAllCount: client.itemAllCount,
    itemCounts: itemCounts(client.items),
    itemNewEvents: client.itemNewEvents.slice(-20),
    itemDestroyEvents: client.itemDestroyEvents.slice(-20),
    errors: client.errors,
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const clientCount = Math.max(2, Number(argValue("clients", "6")) || 6);
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-MAP-${suffix}`);
  const startedAt = new Date().toISOString();
  const clients = Array.from({ length: clientCount }, (_, idx) => createClient({
    baseUrl,
    room,
    id: `qa-map-${idx + 1}-${suffix}`,
    name: `QA Map ${idx + 1}`,
  }));
  const checks = [];
  let collisionAck = null;
  let chosenItem = null;
  let startAck = null;
  let endAck = null;

  try {
    await fs.mkdir(outputDir, { recursive: true });
    const connected = await Promise.all(clients.map((client) => waitForConnected(client)));
    checks.push({ name: "all sockets connected", status: connected.every(Boolean) ? "pass" : "fail", connected });

    await Promise.all(clients.map((client) => client.join()));
    checks.push({
      name: "all clients joined same room",
      status: clients.every((client) => client.roomJoined?.id === room) ? "pass" : "fail",
      joined: clients.map((client) => ({
        id: client.id,
        roomJoined: client.roomJoined,
        serverId: client.serverInfo?.id || null,
      })),
    });

    const serverIds = Array.from(new Set(clients.map((client) => client.serverInfo?.id).filter(Boolean))).sort();
    checks.push({
      name: "clients connected to public ws-server fleet",
      status: serverIds.length >= 1 ? "pass" : "fail",
      serverIds,
      distinctServerCount: serverIds.length,
    });

    startAck = await emitAck(clients[0].socket, "admin.presenter.start", { room }, 8000);
    checks.push({
      name: "presenter start accepted",
      status: startAck?.ok === true ? "pass" : "fail",
      ack: startAck,
    });

    await waitFor(() => clients.every((client) => client.gameOn.length > 0), Math.min(timeoutMs, 45000));
    checks.push({
      name: "all clients received canonical game.on",
      status: clients.every((client) => client.gameOn.length > 0) ? "pass" : "fail",
      gameOn: clients.map((client) => ({
        id: client.id,
        state: latestState(client),
        gameOnCount: client.gameOn.length,
        startPosition: client.gameOn[client.gameOn.length - 1]?.startPosition || null,
      })),
    });

    await waitFor(() => clients.every((client) => itemCounts(client.items).trash > 0), 12000);
    await waitFor(() => compareItemMaps(clients).equal, 5000, 150);
    const initialMap = compareItemMaps(clients);
    checks.push({
      name: "all clients share exact authoritative item map",
      status: initialMap.equal && initialMap.counts.every((count) => count.trash > 0) ? "pass" : "fail",
      ...initialMap,
    });
    checks.push({
      name: "server item appearance stream reaches every client",
      status: clients.every((client) =>
        client.itemAllCount > 0 &&
        client.itemNewEvents.length > 0 &&
        itemCounts(client.items).total > 0
      ) ? "pass" : "fail",
      clients: clients.map((client) => ({
        name: client.name,
        itemAllCount: client.itemAllCount,
        itemNewCount: client.itemNewEvents.length,
        itemCounts: itemCounts(client.items),
      })),
    });

    chosenItem = chooseCommonItem(clients, "trash");
    checks.push({
      name: "common trash item selected for server collision",
      status: chosenItem?.id && chosenItem.type === "trash" ? "pass" : "fail",
      chosenItem,
    });

    const baselineIds = new Set(Object.keys(clients[0].items || {}));
    if (chosenItem?.id) {
      collisionAck = await emitAck(clients[0].socket, "items.collision", {
        itemId: chosenItem.id,
        playerId: clients[0].id,
        playerName: clients[0].name,
        clientPosition: { x: chosenItem.x, y: chosenItem.y, z: chosenItem.z },
        clientItemPosition: { x: chosenItem.x, y: chosenItem.y, z: chosenItem.z },
      }, 8000);
    }
    checks.push({
      name: "server accepts collision against shared item position",
      status: collisionAck?.ok === true && collisionAck?.itemId === chosenItem?.id ? "pass" : "fail",
      collisionAck,
      chosenItem,
    });

    await waitFor(() => clients.every((client) => !client.items[chosenItem?.id]), 8000, 100);
    const destroySeenByAll = clients.every((client) =>
      client.itemDestroyEvents.some((event) => event.id === chosenItem?.id)
    );
    checks.push({
      name: "destroy event removes collected item for every client",
      status: chosenItem?.id && destroySeenByAll && clients.every((client) => !client.items[chosenItem.id]) ? "pass" : "fail",
      chosenItemId: chosenItem?.id || null,
      destroyEvents: clients.map((client) => ({
        name: client.name,
        sawDestroy: client.itemDestroyEvents.some((event) => event.id === chosenItem?.id),
        itemStillPresent: !!client.items[chosenItem?.id],
      })),
    });

    await waitFor(() => {
      const map = compareItemMaps(clients);
      const restoredCount = map.counts.every((count) => count.total >= (initialMap.counts[0]?.total || 0));
      const newCommonId = commonIds(clients).some((id) => !baselineIds.has(id));
      return map.equal && (restoredCount || newCommonId);
    }, 8000, 250);
    await waitFor(() => compareItemMaps(clients).equal, 5000, 150);
    const postRefillMap = compareItemMaps(clients);
    const newCommonIds = commonIds(clients).filter((id) => !baselineIds.has(id));
    const initialTotal = initialMap.counts[0]?.total || 0;
    const restoredToInitialCount = postRefillMap.counts.every((count) => count.total >= initialTotal);
    const stayedConvergedAfterDestroy = postRefillMap.equal && postRefillMap.counts.every((count) => count.total >= Math.max(0, initialTotal - 1));
    checks.push({
      name: "post-destroy item map remains converged for every client",
      status: stayedConvergedAfterDestroy ? "pass" : "fail",
      newCommonIds: newCommonIds.slice(0, 8),
      restoredToInitialCount,
      ...postRefillMap,
    });

    endAck = await emitAck(clients[0].socket, "admin.presenter.end", { room }, 5000);
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
    collisionAck,
    chosenItem,
    endAck,
    clients: clients.map(summarizeClient),
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    "# Shared Item Map Probe",
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
    if (check.name.includes("authoritative item map")) {
      lines.push(`  - Counts: ${(check.counts || []).map((count) => `${count.name}=${count.total}/${count.trash} trash/${count.turtles} turtles/${count.powerups} powerups`).join("; ")}`);
      lines.push(`  - Mismatches: ${(check.mismatches || []).length}`);
    }
    if (check.name.includes("appearance stream")) {
      for (const row of check.clients || []) {
        lines.push(`  - ${row.name}: items.all=${row.itemAllCount}, item.new=${row.itemNewCount}, total=${row.itemCounts?.total}`);
      }
    }
    if (check.name.includes("common trash item")) {
      lines.push(`  - Item: ${check.chosenItem ? `${check.chosenItem.id} @ ${check.chosenItem.x},${check.chosenItem.z}` : "-"}`);
    }
    if (check.name === "server accepts collision against shared item position") {
      lines.push(`  - Ack: ok=${check.collisionAck?.ok === true}, error=${check.collisionAck?.error || "-"}`);
    }
    if (check.name.includes("destroy event")) {
      for (const row of check.destroyEvents || []) {
        lines.push(`  - ${row.name}: sawDestroy=${row.sawDestroy}, itemStillPresent=${row.itemStillPresent}`);
      }
    }
    if (check.name.includes("post-destroy item map")) {
      lines.push(`  - New common IDs: ${(check.newCommonIds || []).join(", ") || "-"}`);
      lines.push(`  - Restored to initial count: ${check.restoredToInitialCount === true}`);
      lines.push(`  - Mismatches: ${(check.mismatches || []).length}`);
    }
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
