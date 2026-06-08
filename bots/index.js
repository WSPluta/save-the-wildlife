import { io } from "socket.io-client";
import * as dotenv from "dotenv";
import short from "shortid";
import pino from "pino";

dotenv.config({ path: "./config/.env" });
const logger = pino();

const NODE_ENV = process.env.NODE_ENV || "development";
logger.info(`NODE_ENV: ${NODE_ENV}`);

const TRACE_RATE_IN_MILLIS = parseInt(process.env.TRACE_RATE_IN_MILLIS) || 10;
logger.info(`TRACE_RATE_IN_MILLIS: ${TRACE_RATE_IN_MILLIS} ms`);

const yourId = short();
const yourName = `Bot ${yourId}`;
logger.info(`Name: ${yourName}`);

const BOUNDARY_WIDTH = parseInt(process.env.BOUNDARY_WIDTH) || 89;
const BOUNDARY_HEIGHT = parseInt(process.env.BOUNDARY_HEIGHT) || 23;
const boundaries = { width: BOUNDARY_WIDTH, height: BOUNDARY_HEIGHT };
logger.info(`Boundaries: ${JSON.stringify(boundaries)}`);

const WS_SERVER_SERVICE_HOST = process.env.WS_SERVER_SERVICE_HOST;
if (!WS_SERVER_SERVICE_HOST) {
  logger.error(`WS_SERVER_SERVICE_HOST not defined`);
  process.exit(1);
}
const WS_SERVER_SERVICE_PORT = process.env.WS_SERVER_SERVICE_PORT;
if (!WS_SERVER_SERVICE_PORT) {
  logger.error(`WS_SERVER_SERVICE_PORT not defined`);
  process.exit(1);
}

let items = {};
let players = {};

const webSocketServerUrl = `ws://${WS_SERVER_SERVICE_HOST}:${WS_SERVER_SERVICE_PORT}`;
logger.info(`Connecting to WS Server on ${webSocketServerUrl}`);

let botPool = [];
let currentGameState = 'WAITING';
let totalPlayers = 0;
let neededBots = 0;
const MAX_BOTS = 10; // Cap to prevent overload
const TARGET_PLAYERS = 4;

function createBotInstance(id) {
  const botId = id || short();
  const botName = `Bot ${botId.substring(0, 4)}`;
  const botSocket = io(webSocketServerUrl);
  let botItems = {};
  let botPlayers = {};
  let botPosition = { x: 0, y: 0, z: 0 };
  let botRotation = { y: 0 };
  let botSpeed = 0;
  let botKeyboard = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
  };
  let gameActive = false;

  botSocket.on("connect", () => {
    logger.info(`Bot ${botId} connected`);
    botSocket.emit("player.info.joining", { id: botId, name: botName });
  });

  botSocket.on("disconnect", () => {
    logger.info(`Bot ${botId} disconnected`);
  });

  botSocket.on("error", (error) => {
    logger.error(`Bot ${botId} error:`, error);
  });

  botSocket.on("server.info", (data) => {
    logger.info(`Bot ${botId} server info:`, data);
  });

  botSocket.on("game.state", (state) => {
    currentGameState = state;
    gameActive = state === 'RUNNING';
    if (state === 'WAITING') {
      botSpeed = 0; // Stop movement
    }
  });

  botSocket.on("startingGame", (data) => {
    gameActive = false; // Pause during countdown
  });

  botSocket.on("game.end", () => {
    gameActive = false;
    botSpeed = 0;
  });

  botSocket.on("items.all", (data) => {
    botItems = data;
  });

  botSocket.on("item.new", ({ id, data }) => {
    botItems[id] = data;
  });

  botSocket.on("item.destroy", (id) => {
    delete botItems[id];
  });

  botSocket.on("player.trace.all", (data) => {
    botPlayers = data;
  });

  // Bot animation loop
  setInterval(() => {
    if (!gameActive) {
      botSpeed *= 0.95; // Slow down
      if (Math.abs(botSpeed) < 0.01) botSpeed = 0;
    } else {
      // Basic AI: Random movement, avoid others, seek items
      const rand = Math.random();
      if (rand < 0.3) botKeyboard.ArrowUp = true;
      else if (rand < 0.4) botKeyboard.ArrowDown = true;
      if (rand < 0.15) botKeyboard.ArrowLeft = true;
      else if (rand < 0.3) botKeyboard.ArrowRight = true;

      // Seek nearest trash
      let nearestItem = null;
      let minDist = Infinity;
      for (const [itemId, item] of Object.entries(botItems)) {
        if (item.type === 'trash') {
          const dx = item.position.x - botPosition.x;
          const dz = item.position.z - botPosition.z;
          const dist = Math.sqrt(dx*dx + dz*dz);
          if (dist < minDist) {
            minDist = dist;
            nearestItem = itemId;
          }
        }
      }
      if (nearestItem && minDist < 2) {
        // Simulate collision
        botSocket.emit("items.collision", { itemId: nearestItem, playerId: botId, playerName: botName });
        botKeyboard.ArrowUp = false; // Stop on collect
      }

      // Avoid other players
      for (const [pid, player] of Object.entries(botPlayers)) {
        if (pid === botId) continue;
        const dx = player.x - botPosition.x;
        const dz = player.z - botPosition.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist < 1.5) {
          botKeyboard.ArrowDown = true; // Brake
          botKeyboard.ArrowUp = false;
        }
      }
    }

    // Movement physics (similar to client)
    const dt = 0.016; // Assume 60 FPS
    const ACCELERATION = 0.005;
    const BRAKE = 0.1;
    const MAX_SPEED = 0.05;
    const TURN_SPEED = Math.PI / 180;
    const FRICTION = 0.02;

    if (botKeyboard.ArrowUp) {
      botSpeed += ACCELERATION;
    } else if (botKeyboard.ArrowDown) {
      botSpeed -= BRAKE;
    } else {
      botSpeed *= (1 - FRICTION);
    }

    botSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, botSpeed));

    if (botKeyboard.ArrowLeft) {
      botRotation.y += TURN_SPEED;
    }
    if (botKeyboard.ArrowRight) {
      botRotation.y -= TURN_SPEED;
    }

    const direction = Math.cos(botRotation.y); // Simplified 2D
    botPosition.x += Math.sin(botRotation.y) * botSpeed * dt;
    botPosition.z += direction * botSpeed * dt;

    // Bounds check
    botPosition.x = Math.max(-boundaries.width/2, Math.min(boundaries.width/2, botPosition.x));
    botPosition.z = Math.max(-boundaries.height/2, Math.min(boundaries.height/2, botPosition.z));

    // Emit trace
    const trace = {
      id: botId,
      x: botPosition.x.toFixed(5),
      z: botPosition.z.toFixed(5),
      rotY: botRotation.y.toFixed(5),
    };
    botSocket.emit("player.trace.change", trace);

    // Reset keys after short duration
    setTimeout(() => {
      Object.keys(botKeyboard).forEach(key => botKeyboard[key] = false);
    }, 300);
  }, 50); // ~20Hz update

  return { socket: botSocket, id: botId, name: botName };
}

function updateBotPool() {
  let needed = Math.max(0, TARGET_PLAYERS - totalPlayers);
  if (needed > MAX_BOTS) needed = MAX_BOTS;

  // Spawn new bots if needed
  while (botPool.length < needed) {
    const newBot = createBotInstance();
    botPool.push(newBot);
    logger.info(`Spawned bot ${newBot.id}, pool size: ${botPool.length}`);
  }

  // Remove excess bots
  while (botPool.length > needed) {
    const bot = botPool.pop();
    bot.socket.disconnect();
    logger.info(`Removed bot ${bot.id}, pool size: ${botPool.length}`);
  }
}

// Manager socket for listening to global events
const managerSocket = io(webSocketServerUrl);
managerSocket.on("connect", () => {
  logger.info("Bot manager connected");
});

managerSocket.on("player.count", (data) => {
  totalPlayers = data.total || 0;
  logger.info(`Player count update: total=${totalPlayers}, needed bots=${Math.max(0, TARGET_PLAYERS - totalPlayers)}`);
  updateBotPool();
});

managerSocket.on("game.state", (state) => {
  currentGameState = state;
  logger.info(`Global game state: ${state}`);
  // Propagate to bots if needed
});

managerSocket.on("startingGame", () => {
  logger.info("Game starting, pause bots");
  // Bots already handle per-socket states
});

managerSocket.on("game.end", () => {
  logger.info("Game ended, reset bots");
  totalPlayers = 0; // Reset count for next game
  updateBotPool();
});

// Initial spawn (assume 0 players)
updateBotPool();

async function terminate() {
  try {
    managerSocket.disconnect();
  } catch (_) {}
  while (botPool.length > 0) {
    const bot = botPool.pop();
    try { bot.socket.disconnect(); } catch (_) {}
  }
  process.exit(0);
}

process.on("SIGTERM", async () => {
  await terminate();
});

process.on("SIGINT", async () => {
  await terminate();
});
