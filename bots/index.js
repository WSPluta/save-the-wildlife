import { io } from "socket.io-client";
import * as dotenv from "dotenv";
import short from "short-uuid";
import pino from "pino";
import {
  buildGameEvent,
  buildTrace,
  computeInputToward,
  desiredBotCount,
  integrateBotMotion,
  parseBotConfig,
  planBotPoolSize,
  selectTargetItem,
  syntheticMechanicForTick,
} from "./bot-behavior.mjs";

dotenv.config({ path: "./config/.env" });

const logger = pino();
const config = parseBotConfig(process.env);
const WS_SERVER_SERVICE_HOST = process.env.WS_SERVER_SERVICE_HOST;
const WS_SERVER_SERVICE_PORT = process.env.WS_SERVER_SERVICE_PORT;
const webSocketServerUrl = process.env.BOT_WS_URL ||
  (WS_SERVER_SERVICE_HOST && WS_SERVER_SERVICE_PORT
    ? `ws://${WS_SERVER_SERVICE_HOST}:${WS_SERVER_SERVICE_PORT}`
    : "");

if (!webSocketServerUrl) {
  logger.error("Set BOT_WS_URL or WS_SERVER_SERVICE_HOST/WS_SERVER_SERVICE_PORT for deployed bots");
  process.exit(1);
}

logger.info({
  nodeEnv: process.env.NODE_ENV || "development",
  target: webSocketServerUrl,
  room: config.roomId,
  targetPlayers: config.targetPlayers,
  minBots: config.minBots,
  maxBots: config.maxBots,
  eventGeneration: config.eventGeneration,
}, "starting Save the Wildlife bot data manager");

let botPool = [];
let playerCounts = { total: 0, humans: 0, bots: 0 };
let resizeState = {};

function socketOptions() {
  return {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 8000,
  };
}

function emitWithAck(socket, eventName, payload, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: "socket_not_connected" });
      return;
    }
    socket.timeout(timeoutMs).emit(eventName, payload, (error, response) => {
      if (error) {
        resolve({ ok: false, error: error.message || String(error) });
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

function createBotInstance(index) {
  const id = `bot-${short.generate()}`;
  const shortId = id.slice(4, 10);
  const name = `${config.botNamePrefix} ${shortId}`;
  const roomId = config.roomId;
  const createdAt = Date.now();
  const sessionId = `${config.sessionPrefix}:${roomId}:${id}:${createdAt}`;
  const socket = io(webSocketServerUrl, socketOptions());
  const bot = {
    id,
    shortId,
    name,
    index,
    roomId,
    sessionId,
    socket,
    joined: false,
    active: false,
    started: false,
    score: 0,
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    speed: 0,
    seq: 0,
    target: null,
    targetAt: 0,
    strategy: index % 3 === 0 ? "powerup_first" : index % 3 === 1 ? "trash_collector" : "trail_drama",
    items: {},
    players: {},
    mechanicTick: 0,
    lastPositionEventAt: 0,
    lastMechanicEventAt: 0,
    lastGameOverAt: 0,
    lastAuthoritativeStateAt: 0,
    lastMotionAt: Date.now(),
  };

  function joinRoom() {
    if (!socket.connected) return;
    socket.emit("room.join", { id: roomId });
  }

  function announcePlayer() {
    if (!socket.connected || !bot.joined) return;
    const profile = {
      id,
      name,
      room: roomId,
      clientSessionId: `client:${sessionId}`,
      gameplaySessionId: sessionId,
    };
    socket.emit("player.info.joining", profile);
    socket.emit("game.start", {
      playerId: id,
      playerName: name,
      clientSessionId: profile.clientSessionId,
      gameplaySessionId: profile.gameplaySessionId,
    });
  }

  async function emitGameEvent(type, overrides = {}) {
    if (!config.eventGeneration || !socket.connected || !bot.joined) return null;
    const payload = buildGameEvent(type, bot, overrides);
    const response = await emitWithAck(socket, "game.event", payload, 3000);
    if (response?.ok === false) {
      logger.debug({ bot: id, type, error: response.error }, "bot game.event rejected");
    }
    return response;
  }

  async function maybeEmitSyntheticMechanics(now) {
    if (!bot.active || !config.eventGeneration || !config.emitSyntheticMechanics) return;
    if (now - bot.lastMechanicEventAt < config.mechanicsEventIntervalMs) return;
    bot.lastMechanicEventAt = now;
    bot.mechanicTick += 1;
    await emitWithAck(socket, "game.event", syntheticMechanicForTick(bot, bot.mechanicTick), 3000);
  }

  async function maybeEmitPositionSample(now) {
    if (!bot.active) return;
    if (now - bot.lastPositionEventAt < config.positionEventIntervalMs) return;
    bot.lastPositionEventAt = now;
    await emitGameEvent("position_sample", {
      score: bot.score,
      metadata: {
        target_item_id: bot.target?.id || null,
        target_kind: bot.target?.kind || null,
      },
    });
  }

  function updateTarget(now) {
    if (bot.target && now - bot.targetAt < config.targetRefreshMs) return bot.target;
    const preferences = bot.strategy === "powerup_first"
      ? ["powerup", "trash", "marine"]
      : bot.strategy === "trail_drama"
        ? ["trash", "powerup", "marine"]
        : ["trash", "powerup", "marine"];
    bot.target = selectTargetItem(bot.position, bot.items, preferences, {
      rankOffset: bot.index,
      pickWindow: 6,
      jitter: bot.index * 0.08,
    });
    bot.targetAt = now;
    return bot.target;
  }

  async function maybeCollide(target) {
    if (!bot.active || !target || target.distance > config.collisionRadius) return;
    const response = await emitWithAck(socket, "items.collision", {
      itemId: target.id,
      playerId: id,
      playerName: name,
    }, 3000);
    if (response?.ok) {
      bot.score += Number(response.scoreDelta || 0);
      delete bot.items[target.id];
      bot.target = null;
      bot.targetAt = 0;
      logger.debug({ bot: id, itemId: target.id, itemType: response.itemType, scoreDelta: response.scoreDelta }, "bot item collision accepted");
    }
  }

  async function tick() {
    const now = Date.now();
    if (!socket.connected || !bot.joined) return;
    const target = bot.active ? updateTarget(now) : null;
    const input = bot.active
      ? computeInputToward(bot.position, bot.rotationY, target, config)
      : { throttle: 0, steer: 0, brake: false };
    const dt = Math.max(0.001, Math.min(0.25, (now - (bot.lastMotionAt || now)) / 1000));
    bot.lastMotionAt = now;
    if (bot.active && now - (bot.lastAuthoritativeStateAt || 0) > 1000) {
      integrateBotMotion(bot, input, config, dt);
    }

    socket.emit("player.input", {
      id,
      seq: bot.seq++,
      throttle: input.throttle,
      steer: input.steer,
      brake: input.brake,
    });
    socket.emit("player.trace.change", buildTrace(id, bot.position, bot.rotationY));

    await maybeCollide(target);
    await maybeEmitPositionSample(now);
    await maybeEmitSyntheticMechanics(now);
  }

  socket.on("connect", () => {
    logger.info({ bot: id, room: roomId }, "bot connected");
    joinRoom();
  });

  socket.on("room.joined", (body = {}) => {
    if (body.id !== roomId) return;
    bot.joined = true;
    announcePlayer();
  });

  socket.on("player.session", (profile = {}) => {
    if (profile?.gameplaySessionId) bot.sessionId = profile.gameplaySessionId;
  });

  socket.on("game.state", (state) => {
    bot.active = state === "RUNNING";
    if (state === "WAITING" || state === "ENDED") bot.started = false;
  });

  socket.on("game.on", async ({ startPosition } = {}) => {
    if (startPosition) {
      const fanoutRadius = Number(config.spawnFanoutRadius || 0);
      const fanoutAngle = ((bot.index - 1) / Math.max(1, config.maxBots || 1)) * Math.PI * 2;
      const x = Number(startPosition.x || 0) + Math.sin(fanoutAngle) * fanoutRadius;
      const z = Number(startPosition.z || 0) + Math.cos(fanoutAngle) * fanoutRadius;
      bot.position = {
        x: Math.max(-config.worldHalfWidth, Math.min(config.worldHalfWidth, x)),
        y: Number(startPosition.y || 0),
        z: Math.max(-config.worldHalfHeight, Math.min(config.worldHalfHeight, z)),
      };
      bot.rotationY = fanoutAngle + Math.PI;
      bot.speed = 0;
    }
    bot.active = true;
    bot.started = true;
    bot.score = 0;
    bot.sessionId = `${config.sessionPrefix}:${roomId}:${id}:${Date.now()}`;
    await emitGameEvent("game_started", { score: 0 });
  });

  socket.on("game.end", async () => {
    bot.active = false;
    const now = Date.now();
    if (now - bot.lastGameOverAt < config.gameOverDelayMs) return;
    bot.lastGameOverAt = now;
    setTimeout(() => {
      emitGameEvent("game_over", {
        score: bot.score,
        metadata: {
          final_score: bot.score,
          bot_strategy: bot.strategy,
          generated_for: "commentary_training",
        },
      }).catch((error) => logger.debug({ bot: id, error: error.message }, "bot game_over emit failed"));
    }, config.gameOverDelayMs);
  });

  socket.on("items.all", (data = {}) => {
    bot.items = data || {};
  });

  socket.on("item.new", ({ id: itemId, data } = {}) => {
    if (itemId && data) bot.items[itemId] = data;
  });

  socket.on("item.destroy", (body = {}) => {
    const itemId = typeof body === "string" ? body : body.id || body.itemId;
    if (itemId) delete bot.items[itemId];
  });

  socket.on("player.state", ({ states = {} } = {}) => {
    const own = states[id];
    if (own) {
      bot.position = {
        x: Number(own.x || 0),
        y: 0,
        z: Number(own.z || 0),
      };
      bot.rotationY = Number(own.rotY || 0);
      bot.speed = Number(own.speed || own.vel || 0);
      bot.lastAuthoritativeStateAt = Date.now();
    }
    for (const [playerId, state] of Object.entries(states || {})) {
      if (playerId !== id) bot.players[playerId] = state;
    }
    const nearest = Object.entries(bot.players)
      .map(([playerId, state]) => ({
        playerId,
        distance: Math.hypot(Number(state.x || 0) - bot.position.x, Number(state.z || 0) - bot.position.z),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance < 3) bot.lastNearbyPlayerId = nearest.playerId;
  });

  socket.on("disconnect", (reason) => {
    bot.joined = false;
    bot.active = false;
    logger.info({ bot: id, reason }, "bot disconnected");
  });

  socket.on("connect_error", (error) => {
    logger.warn({ bot: id, error: error.message }, "bot connect error");
  });

  bot.interval = setInterval(() => {
    tick().catch((error) => logger.debug({ bot: id, error: error.message }, "bot tick failed"));
  }, config.traceRateMs);

  return bot;
}

function updateBotPool() {
  const desired = desiredBotCount(playerCounts, config);
  const plan = planBotPoolSize(botPool.length, desired, resizeState, config, Date.now());
  resizeState = plan.state;
  if (plan.reason !== "stable") {
    logger.debug({ current: botPool.length, desired, planned: plan.size, reason: plan.reason }, "bot pool resize plan");
  }
  while (botPool.length < plan.size) {
    const bot = createBotInstance(botPool.length + 1);
    botPool.push(bot);
    logger.info({ bot: bot.id, pool: botPool.length, desired, planned: plan.size }, "spawned bot");
  }
  while (botPool.length > plan.size) {
    const bot = botPool.pop();
    clearInterval(bot.interval);
    try { bot.socket.disconnect(); } catch (_) {}
    logger.info({ bot: bot.id, pool: botPool.length, desired, planned: plan.size }, "removed bot");
  }
}

const managerSocket = io(webSocketServerUrl, socketOptions());

managerSocket.on("connect", () => {
  logger.info("bot manager connected");
  updateBotPool();
});

managerSocket.on("player.count", (data = {}) => {
  playerCounts = {
    total: Number(data.total || data.players?.total || 0),
    humans: Number(data.humans ?? data.players?.humans ?? 0),
    bots: Number(data.bots ?? data.players?.bots ?? 0),
  };
  logger.info({ ...playerCounts, desired: desiredBotCount(playerCounts, config) }, "player count update");
  updateBotPool();
});

managerSocket.on("disconnect", (reason) => {
  logger.warn({ reason }, "bot manager disconnected");
});

managerSocket.on("connect_error", (error) => {
  logger.warn({ error: error.message }, "bot manager connect error");
});

updateBotPool();

async function terminate() {
  try { managerSocket.disconnect(); } catch (_) {}
  while (botPool.length > 0) {
    const bot = botPool.pop();
    clearInterval(bot.interval);
    try { bot.socket.disconnect(); } catch (_) {}
  }
  process.exit(0);
}

process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);
