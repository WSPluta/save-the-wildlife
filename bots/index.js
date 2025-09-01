import { io } from "socket.io-client";
import * as dotenv from "dotenv";
import shortid from "shortid";
import pino from "pino";
import * as THREE from "three";
import { throttle } from "throttle-debounce";

dotenv.config({ path: "./config/.env" });
const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "debug" });

/**
 * Bot Orchestrator
 * - Keeps at least MIN_PLAYERS players in the match by spawning/removing bots.
 * - Each bot connects with its own socket, joins the match, and periodically sends position traces.
 * - Movement is simple wandering with boundary constraints.
 *
 * Network fields match server expectations:
 * - player.info.joining { id, name }
 * - game.start { playerId, playerName }
 * - player.trace.change { id, x, z, rotY }
 */

const MIN_PLAYERS = 4;

// WS server
const WS_SERVER_SERVICE_HOST = process.env.WS_SERVER_SERVICE_HOST || "localhost";
const WS_SERVER_SERVICE_PORT = process.env.WS_SERVER_SERVICE_PORT || "3000";
const webSocketServerUrl = `ws://${WS_SERVER_SERVICE_HOST}:${WS_SERVER_SERVICE_PORT}`;

logger.info(`WS server: ${webSocketServerUrl}`);

const TRACE_RATE_IN_MILLIS = parseInt(process.env.TRACE_RATE_IN_MILLIS || "50", 10);

// Boundaries (fallback defaults overridden by server.info if provided)
let boundaries = {
  width: parseInt(process.env.BOUNDARY_WIDTH || "89", 10),
  height: parseInt(process.env.BOUNDARY_HEIGHT || "23", 10),
};

let latestCounts = null;

// Global state observed from the server (humans + anyone sending traces)
// We maintain a separate set of bot ids to exclude our own bots from the human count.
const players = {};
const botIds = new Set();

// One control socket to observe server state and decide how many bots to run
const controlSocket = io(webSocketServerUrl, {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
});

controlSocket.io.on("reconnect_attempt", (a) => logger.info(`reconnect_attempt #${a}`));
controlSocket.io.on("reconnect_error", (err) => logger.error(`reconnect_error: ${err?.message || err}`));
controlSocket.io.on("reconnect_failed", () => logger.error("reconnect_failed"));
controlSocket.on("connect_error", (err) => logger.error(`connect_error: ${err?.message || err}`));

controlSocket.on("connect", () => {
  logger.info(`Control socket connected`);
});
controlSocket.on("disconnect", () => {
  logger.warn(`Control socket disconnected`);
});

// Update boundaries and any server config
controlSocket.on("server.info", (data) => {
  logger.info(`server.info: ${JSON.stringify(data)}`);
  if (typeof data.worldSizeX === "number" && typeof data.worldSizeZ === "number") {
    boundaries.width = data.worldSizeX;
    boundaries.height = data.worldSizeZ;
    logger.info(`Boundaries updated from server: ${boundaries.width} x ${boundaries.height}`);
  }
});

/**
 * Server aggregated counts (humans, bots, total)
 * Prefer these for orchestration if available.
 */
controlSocket.on("player.count", (data) => {
  latestCounts = data;
  try {
    logger.debug ? logger.debug(`player.count: ${JSON.stringify(data)}`) : logger.info(`player.count: ${JSON.stringify(data)}`);
  } catch {}
});

// Track players from traces (includes bots and humans)
controlSocket.on("player.trace.all", (data) => {
  for (const [id, trace] of Object.entries(data)) {
    players[id] = { ...(players[id] || {}), ...trace };
  }
});

// Newly joined player info
controlSocket.on("player.info.joined", ({ id, name }) => {
  players[id] = { ...(players[id] || {}), name };
});

// Player left
controlSocket.on("player.info.left", (id) => {
  delete players[id];
});

// Full snapshot of players info
controlSocket.on("player.info.all", (data) => {
  Object.assign(players, data || {});
});

// Maintain bots up/down to ensure minimum players
const managedBots = []; // [{ id, name, socket, timerId, state, position, rotation }]
function totalHumanCount() {
  // Prefer server authoritative humans count
  if (latestCounts && typeof latestCounts.humans === "number") {
    return latestCounts.humans;
  }
  // Fallback: Players minus bots we manage
  let count = 0;
  for (const id of Object.keys(players)) {
    if (!botIds.has(id)) count++;
  }
  return count;
}

function ensureMinPlayers() {
  const humans = totalHumanCount();
  const currentBotCount = managedBots.length;
  const desiredTotal = Math.max(MIN_PLAYERS, 0);
  const need = Math.max(desiredTotal - humans, 0);

  if (currentBotCount < need) {
    const toAdd = need - currentBotCount;
    logger.info(`Need ${need} bots (have ${currentBotCount}); spawning ${toAdd}`);
    for (let i = 0; i < toAdd; i++) spawnBot();
  } else if (currentBotCount > need) {
    const toRemove = currentBotCount - need;
    logger.info(`Too many bots (${currentBotCount}); removing ${toRemove}`);
    for (let i = 0; i < toRemove; i++) despawnLastBot();
  }
}

setInterval(ensureMinPlayers, 3000);

// Bot lifecycle
function spawnBot() {
  const id = shortid.generate();
  const name = `Bot ${id}`;
  const socket = io(webSocketServerUrl, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  const bot = {
    id,
    name,
    socket,
    state: "WAITING",
    position: { x: 0, y: 0, z: 0 },
    rotation: new THREE.Euler(0, 0, 0, "YXZ"),
    speed: 0,
    timerId: null,
  };

  socket.on("connect", () => {
    logger.info(`Bot ${id} connected`);
    botIds.add(id);
    // Join and start
    socket.emit("player.info.joining", { id, name });
    socket.emit("game.start", { playerId: id, playerName: name });
  });

  socket.on("disconnect", () => {
    logger.info(`Bot ${id} disconnected`);
    cleanupBot(bot);
  });

  socket.on("game.state", (state) => {
    bot.state = state;
  });

  socket.on("game.on", ({ startPosition }) => {
    if (startPosition) {
      bot.position.x = startPosition.x || 0;
      bot.position.y = startPosition.y || 0;
      bot.position.z = startPosition.z || 0;
    }
  });

  socket.on("game.end", () => {
    bot.state = "ENDED";
    bot.speed = 0;
  });

  // Very simple wandering controller
  const MAX_SPEED = 0.035;
  const TURN_RATE = Math.PI / 180; // per update tick
  const DRIFT = 0.98;

  bot.timerId = setInterval(() => {
    if (bot.state !== "RUNNING") return;

    // Random turn and speed
    bot.rotation.y += (Math.random() - 0.5) * TURN_RATE;
    const accel = 0.0005 + Math.random() * 0.0005;
    bot.speed = Math.min(MAX_SPEED, bot.speed * DRIFT + accel);

    // Forward vector in XZ from Euler Y
    const dir = new THREE.Vector3(0, 0, 1).applyEuler(bot.rotation);
    bot.position.x += dir.x * bot.speed * 100; // scale for server expectations (client scales similarly)
    bot.position.z += dir.z * bot.speed * 100;

    // Keep in bounds; if near edges, bias turn inward
    const halfW = boundaries.width / 2 - 1;
    const halfH = boundaries.height / 2 - 1;
    if (bot.position.x < -halfW || bot.position.x > halfW || bot.position.z < -halfH || bot.position.z > halfH) {
      // Flip direction quickly to head back in
      bot.rotation.y += Math.PI * 0.75 * (Math.random() > 0.5 ? 1 : -1);
      bot.position.x = Math.max(-halfW, Math.min(halfW, bot.position.x));
      bot.position.z = Math.max(-halfH, Math.min(halfH, bot.position.z));
    }

    socket.emit("player.trace.change", {
      id,
      x: bot.position.x,
      z: bot.position.z,
      rotY: bot.rotation.y,
    });
  }, TRACE_RATE_IN_MILLIS);

  managedBots.push(bot);
  return bot;
}

function cleanupBot(bot) {
  if (!bot) return;
  if (bot.timerId) {
    clearInterval(bot.timerId);
    bot.timerId = null;
  }
  if (bot.socket && bot.socket.connected) {
    bot.socket.disconnect();
  }
  botIds.delete(bot.id);
  const idx = managedBots.findIndex((b) => b.id === bot.id);
  if (idx >= 0) managedBots.splice(idx, 1);
}

function despawnLastBot() {
  const bot = managedBots.pop();
  if (!bot) return;
  cleanupBot(bot);
}

// Graceful shutdown
async function terminate() {
  logger.info("Shutting down bots...");
  try {
    managedBots.forEach((b) => cleanupBot(b));
    if (controlSocket && controlSocket.connected) controlSocket.disconnect();
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);

// Initial tick to evaluate needed bots ASAP
setTimeout(ensureMinPlayers, 500);
