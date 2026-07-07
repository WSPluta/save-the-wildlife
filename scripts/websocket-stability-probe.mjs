#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "websocket-stability-probe");

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

function summarizePayload(event, payload) {
  if (event === "server.info") {
    return {
      gameDuration: payload?.gameDuration,
      serverAuthEnabled: payload?.serverAuthEnabled,
      started: payload?.started,
    };
  }
  if (event === "room.joined") return payload || {};
  if (event === "game.state") return { state: String(payload || "") };
  if (event === "startingGame") return { startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null };
  if (event === "game.on") return { startPosition: payload?.startPosition || null };
  if (event === "game.time") return { remaining: Number(payload) };
  if (event === "items.all") {
    const values = Object.values(payload || {});
    return {
      count: values.length,
      trash: values.filter((item) => item && item.type !== "turtle" && !String(item.type || "").startsWith("powerup_")).length,
      turtles: values.filter((item) => item?.type === "turtle").length,
      powerups: values.filter((item) => String(item?.type || "").startsWith("powerup_")).length,
      rooms: Array.from(new Set(values.map((item) => item?.room || "missing"))).sort(),
    };
  }
  return undefined;
}

function createClient({ baseUrl, id, name, room }) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 400,
    reconnectionDelayMax: 1500,
    timeout: 10000,
  });
  const client = {
    id,
    name,
    room,
    socket,
    connected: false,
    connectedAt: null,
    roomJoined: null,
    serverInfo: null,
    connectionEvents: [],
    managerEvents: [],
    appEvents: [],
    states: [],
    countdowns: [],
    gameOn: [],
    gameTimes: [],
    itemSnapshots: [],
    errors: [],
  };

  function recordConnection(event, summary = {}) {
    client.connectionEvents.push({ at: Date.now(), event, ...summary });
  }

  function recordManager(event, summary = {}) {
    client.managerEvents.push({ at: Date.now(), event, ...summary });
  }

  function recordApp(event, payload) {
    const summary = summarizePayload(event, payload);
    if (summary !== undefined) client.appEvents.push({ at: Date.now(), event, summary });
    if (client.appEvents.length > 300) client.appEvents.shift();
  }

  socket.on("connect", () => {
    client.connected = true;
    client.connectedAt = client.connectedAt || Date.now();
    recordConnection("connect", { socketId: socket.id, transport: socket.io?.engine?.transport?.name || null });
  });
  socket.on("disconnect", (reason) => {
    client.connected = false;
    recordConnection("disconnect", { reason });
  });
  socket.on("connect_error", (error) => {
    client.errors.push({ at: Date.now(), type: "connect_error", text: error.message || String(error) });
    recordConnection("connect_error", { error: error.message || String(error) });
  });
  socket.io.on("reconnect_attempt", (attempt) => recordManager("reconnect_attempt", { attempt }));
  socket.io.on("reconnect", (attempt) => recordManager("reconnect", { attempt }));
  socket.io.on("reconnect_error", (error) => {
    client.errors.push({ at: Date.now(), type: "reconnect_error", text: error.message || String(error) });
    recordManager("reconnect_error", { error: error.message || String(error) });
  });
  socket.io.on("reconnect_failed", () => recordManager("reconnect_failed"));

  socket.onAny((event, payload) => recordApp(event, payload));
  socket.on("server.info", (payload) => { client.serverInfo = payload || {}; });
  socket.on("room.joined", (payload) => { client.roomJoined = payload || {}; });
  socket.on("game.state", (payload) => client.states.push({ at: Date.now(), state: String(payload || "") }));
  socket.on("startingGame", (payload) => client.countdowns.push({ at: Date.now(), startsAt: payload?.startsAt || null, countdownMs: payload?.countdownMs || null }));
  socket.on("game.on", (payload) => client.gameOn.push({ at: Date.now(), startPosition: payload?.startPosition || null }));
  socket.on("game.time", (payload) => client.gameTimes.push({ at: Date.now(), remaining: Number(payload) }));
  socket.on("items.all", (payload) => {
    const summary = summarizePayload("items.all", payload);
    client.itemSnapshots.push({ at: Date.now(), ...summary });
  });

  client.join = async () => {
    const clientSessionId = `${id}-session-${Date.now()}`;
    const deadline = Date.now() + 12000;
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

function timerStats(client) {
  const times = client.gameTimes.map((entry) => Number(entry.remaining)).filter(Number.isFinite);
  const first = times.length ? times[0] : null;
  const last = times.length ? times[times.length - 1] : null;
  const backwards = [];
  const jumps = [];
  for (let i = 1; i < times.length; i += 1) {
    const previous = times[i - 1];
    const current = times[i];
    if (current > previous) backwards.push({ idx: i, previous, current });
    if (previous - current > 3) jumps.push({ idx: i, previous, current, delta: previous - current });
  }
  return {
    count: times.length,
    first,
    last,
    drop: first != null && last != null ? first - last : null,
    min: times.length ? Math.min(...times) : null,
    max: times.length ? Math.max(...times) : null,
    backwards,
    jumps,
  };
}

function summarizeClient(client) {
  return {
    id: client.id,
    name: client.name,
    room: client.room,
    connected: client.connected,
    roomJoined: client.roomJoined,
    serverInfo: client.serverInfo ? {
      gameDuration: client.serverInfo.gameDuration,
      serverAuthEnabled: client.serverInfo.serverAuthEnabled,
      started: client.serverInfo.started,
    } : null,
    connectionEvents: client.connectionEvents,
    managerEvents: client.managerEvents,
    states: client.states,
    countdowns: client.countdowns,
    gameOn: client.gameOn,
    gameTimes: client.gameTimes.slice(0, 80),
    timerStats: timerStats(client),
    itemSnapshots: client.itemSnapshots.slice(0, 20),
    errors: client.errors,
    appEvents: client.appEvents.slice(-80),
  };
}

function connectionChurn(client) {
  const postInitialEvents = client.connectionEvents.filter((entry) => entry.event !== "connect" || entry !== client.connectionEvents[0]);
  const disconnects = postInitialEvents.filter((entry) => entry.event === "disconnect");
  const connectErrors = client.connectionEvents.filter((entry) => entry.event === "connect_error");
  const reconnects = client.managerEvents.filter((entry) => entry.event.startsWith("reconnect"));
  return { disconnects, connectErrors, reconnects };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const sampleMs = Number(argValue("sample-ms", "45000"));
  const clientCount = Math.max(2, Number(argValue("clients", "6")));
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-WS-${suffix}`);
  await fs.mkdir(outputDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const checks = [];
  const clients = Array.from({ length: clientCount }, (_, idx) =>
    createClient({
      baseUrl,
      id: `qa-ws-${idx + 1}-${suffix}`,
      name: `QA WS ${idx + 1}`,
      room,
    })
  );
  let startAck = null;
  let endAck = null;

  try {
    const connected = await Promise.all(clients.map((client) => waitForConnected(client, 12000)));
    checks.push({ name: "all websocket clients connected", status: connected.every(Boolean) ? "pass" : "fail", connected });

    await Promise.all(clients.map((client) => client.join()));
    checks.push({
      name: "all clients joined target room",
      status: clients.every((client) => client.roomJoined?.id === room) ? "pass" : "fail",
      joined: clients.map((client) => ({ id: client.id, roomJoined: client.roomJoined })),
    });

    startAck = await emitAck(clients[0].socket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    await waitFor(() => clients.every((client) => client.gameOn.length > 0 || client.states.some((entry) => entry.state === "RUNNING")), Math.min(timeoutMs, 30000));
    checks.push({
      name: "all clients observe running state",
      status: clients.every((client) => client.gameOn.length > 0 || client.states.some((entry) => entry.state === "RUNNING")) ? "pass" : "fail",
      clients: clients.map((client) => ({ id: client.id, states: client.states, gameOn: client.gameOn })),
    });

    const observeStartedAt = Date.now();
    await sleep(sampleMs);
    const observeElapsedMs = Date.now() - observeStartedAt;

    const churn = clients.map((client) => ({ id: client.id, ...connectionChurn(client) }));
    checks.push({
      name: "no websocket disconnects or reconnect attempts during observation",
      status: churn.every((entry) => entry.disconnects.length === 0 && entry.connectErrors.length === 0 && entry.reconnects.length === 0) ? "pass" : "fail",
      churn,
    });

    checks.push({
      name: "all clients receive game.time updates",
      status: clients.every((client) => client.gameTimes.length >= Math.max(3, Math.floor(sampleMs / 5000))) ? "pass" : "fail",
      clients: clients.map((client) => ({ id: client.id, count: client.gameTimes.length, timerStats: timerStats(client) })),
    });

    const timerSummaries = clients.map((client) => ({ id: client.id, timerStats: timerStats(client) }));
    const finalTimes = timerSummaries.map((entry) => entry.timerStats.last).filter(Number.isFinite);
    const spread = finalTimes.length ? Math.max(...finalTimes) - Math.min(...finalTimes) : null;
    checks.push({
      name: "timer values remain synchronized across websocket clients",
      status: spread != null && spread <= 2 ? "pass" : "fail",
      spread,
      timerSummaries,
    });

    const expectedDrop = Math.ceil(observeElapsedMs / 1000) + 4;
    checks.push({
      name: "timer pace does not outrun wall clock",
      status: timerSummaries.every((entry) => entry.timerStats.drop == null || entry.timerStats.drop <= expectedDrop) ? "pass" : "fail",
      observeElapsedMs,
      expectedDrop,
      timerSummaries,
    });

    endAck = await emitAck(clients[0].socket, "admin.presenter.end", { room }, 8000);
    checks.push({ name: "admin presenter end accepted", status: endAck?.ok === true ? "pass" : "fail", ack: endAck });

    const result = {
      status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      clientCount,
      sampleMs,
      observeElapsedMs,
      checks,
      clients: clients.map(summarizeClient),
      startAck,
      endAck,
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

    const lines = [
      "# WebSocket Stability Probe",
      "",
      `- Status: ${statusIcon(result.status)}`,
      `- Base URL: \`${baseUrl}\``,
      `- Room: \`${room}\``,
      `- Clients: ${clientCount}`,
      `- Sample window: ${sampleMs}ms`,
      "",
      "## Checks",
      ...checks.map((check) => {
        if (check.name.includes("disconnects")) {
          const churnCount = check.churn?.reduce((sum, entry) => sum + entry.disconnects.length + entry.connectErrors.length + entry.reconnects.length, 0) || 0;
          return `- ${statusIcon(check.status)} ${check.name}; churnEvents=${churnCount}`;
        }
        if (check.name.includes("timer values")) return `- ${statusIcon(check.status)} ${check.name}; spread=${check.spread}`;
        if (check.name.includes("timer pace")) return `- ${statusIcon(check.status)} ${check.name}; expectedDrop<=${check.expectedDrop}`;
        return `- ${statusIcon(check.status)} ${check.name}`;
      }),
      "",
      "## Timer Summary",
      ...clients.map((client) => {
        const stats = timerStats(client);
        return `- ${client.id}: count=${stats.count}; first=${stats.first}; last=${stats.last}; drop=${stats.drop}; disconnects=${connectionChurn(client).disconnects.length}; reconnects=${connectionChurn(client).reconnects.length}`;
      }),
    ];
    await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
    if (result.status !== "pass") process.exitCode = 1;
  } catch (error) {
    const result = {
      status: "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      clientCount,
      sampleMs,
      checks,
      error: error?.stack || error?.message || String(error),
      clients: clients.map(summarizeClient),
      startAck,
      endAck,
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "latest.md"), `# WebSocket Stability Probe\n\n- Status: FAIL\n- Error: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  } finally {
    for (const client of clients) client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
