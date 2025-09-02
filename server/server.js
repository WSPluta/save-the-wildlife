import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import * as dotenv from "dotenv";
import short from "short-uuid";
import pino from "pino";
import { deleteCurrentScore, postCurrentScore } from "./score.js";
import pkg from "./package.json" assert { type: "json" };
import ObjectPool from './object-pool.js';

dotenv.config({ path: "../.config/.env" });

const isProduction = process.env.NODE_ENV === "production";
const logger = pino({ level: isProduction ? "warn" : "debug" });

const version = pkg.version;
logger.info(`Server version ${version}`);
const serverId = short.generate();
logger.info(`Server ${serverId}`);

const ENABLE_COHERENCE_BACKEND =
  process.env.ENABLE_COHERENCE_BACKEND === "true";

const BROADCAST_REFRESH_UPDATE = process.env.BROADCAST_REFRESH_UPDATE
  ? parseInt(process.env.BROADCAST_REFRESH_UPDATE)
  : 50;

const CLEANUP_STALE_IN_SECONDS = process.env.CLEANUP_STALE_IN_SECONDS
  ? parseInt(process.env.CLEANUP_STALE_IN_SECONDS)
  : 2;
const BROADCAST_ITEMS_IN_SECONDS = process.env.BROADCAST_ITEMS_IN_SECONDS
  ? parseInt(process.env.BROADCAST_ITEMS_IN_SECONDS)
  : 2;

const ITEM_MAX_SIZE = process.env.ITEM_MAX_SIZE
  ? parseFloat(process.env.ITEM_MAX_SIZE)
  : 0.9;
const ITEM_MIN_SIZE = process.env.ITEM_MIN_SIZE
  ? parseFloat(process.env.ITEM_MIN_SIZE)
  : 0.5;

const WORLD_SIZE_X = process.env.WORLD_SIZE_X
  ? parseInt(process.env.WORLD_SIZE_X)
  : 88;
const WORLD_SIZE_Z = process.env.WORLD_SIZE_Z
  ? parseInt(process.env.WORLD_SIZE_Z)
  : 22;

const GAME_DURATION_IN_SECONDS = process.env.GAME_DURATION_IN_SECONDS
  ? parseInt(process.env.GAME_DURATION_IN_SECONDS)
  : 180;

const PHYSICS_CONFIG = {
  acceleration: parseFloat(process.env.PHYS_ACCELERATION ?? "6"),
  brake: parseFloat(process.env.PHYS_BRAKE ?? "3"),
  maxSpeed: parseFloat(process.env.PHYS_MAX_SPEED ?? "3"),
  friction: parseFloat(process.env.PHYS_FRICTION ?? "1.5"),
  turnSpeed: parseFloat(process.env.PHYS_TURN_SPEED ?? "0.523599"),
  driftFactor: parseFloat(process.env.PHYS_DRIFT ?? "0")
};

const SERVER_AUTH_ENABLED = process.env.SERVER_AUTH_ENABLED === "true";
const SIM_TPS = parseInt(process.env.SIM_TPS ?? "60");
const STATE_BROADCAST_HZ = parseInt(process.env.STATE_BROADCAST_HZ ?? "20");
const COLLISION_VALIDATE_RADIUS = parseFloat(process.env.COLLISION_VALIDATE_RADIUS ?? "1.0");
const POWERUP_SPEED_MULTIPLIER = parseFloat(process.env.POWERUP_SPEED_MULTIPLIER ?? "2");
const POWERUP_SPEED_DURATION_MS = parseInt(process.env.POWERUP_SPEED_DURATION_MS ?? "10000");
const POWERUP_SHIELD_DURATION_MS = parseInt(process.env.POWERUP_SHIELD_DURATION_MS ?? "5000");

// Lobby chat (server-side buffer) and settings
const CHAT_HISTORY_LIMIT = 100;
const chatHistory = [];
// We reuse mapPlayersInfo as the lobby roster; emit 'lobby.players' when it changes.

let gameState = 'WAITING';
let gameStartTime = null;
let gameStartingAt = null;
let gameTimer = null;

let mapPlayersTraces;
let mapPlayersInfo;
let mapTrash;
let mapMarineLife;
let mapPowerUps;
let mapPlayerSockets;

const playersState = new Map();
const playersInput = new Map();

function createObject() {
  const x = Math.round((Math.random() - 0.5) * (WORLD_SIZE_X - 1));
  const y = 0;
  const z = Math.round((Math.random() - 0.5) * (WORLD_SIZE_Z - 1));
  const size = (Math.random() * (ITEM_MAX_SIZE - ITEM_MIN_SIZE) + ITEM_MIN_SIZE).toFixed(2);
  return { 
    id: short.generate(), 
    type: 'unknown', 
    position: { x, y, z }, 
    size 
  };
}
const itemPool = new ObjectPool(createObject, 50, 1000);

export async function start(
  httpServer,
  port,
  cacheSession,
  pubClient,
  subClient
) {
  const io = new Server(httpServer, {});

  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
  }

  if (ENABLE_COHERENCE_BACKEND) {
    mapPlayersTraces = await cacheSession.getMap("playerTraces");
    mapPlayersInfo = await cacheSession.getMap("playersInfo");
    mapTrash = await cacheSession.getMap("trash");
    mapMarineLife = await cacheSession.getMap("marineLife");
    mapPowerUps = await cacheSession.getMap("powerUps");
    mapPlayerSockets = {};
  } else {
    mapPlayersTraces = {};
    mapPlayersInfo = {};
    mapTrash = {};
    mapMarineLife = {};
    mapPowerUps = {};
    mapPlayerSockets = {};
  }

  async function getPlayersInfoObject() {
    return ENABLE_COHERENCE_BACKEND ? await readCacheEntries(mapPlayersInfo) : mapPlayersInfo;
  }

  async function emitPlayerCount() {
    try {
      const info = await getPlayersInfoObject();
      const ids = Object.keys(info || {});
      const total = ids.length;
      let bots = 0;
      ids.forEach((id) => {
        const name = (info[id] && info[id].name) ? String(info[id].name) : "";
        if (name.toLowerCase().startsWith("bot ")) bots++;
      });
      const humans = Math.max(0, total - bots);
      io.emit("player.count", { total, humans, bots });
    } catch (e) {
      logger.error(`emitPlayerCount error: ${e && e.message ? e.message : e}`);
    }
  }

  io.on("connection", async (socket) => {
    let playerIdForSocket;

    socket.emit("server.info", {
      id: serverId,
      version: version,
      gameDuration: GAME_DURATION_IN_SECONDS,
      worldSizeX: WORLD_SIZE_X,
      worldSizeZ: WORLD_SIZE_Z,
      serverAuthEnabled: SERVER_AUTH_ENABLED,
      physics: PHYSICS_CONFIG,
    });

    const trashFromCache = ENABLE_COHERENCE_BACKEND
      ? await readCacheEntries(mapTrash)
      : mapTrash;
    const marineLifeFromCache = ENABLE_COHERENCE_BACKEND
      ? await readCacheEntries(mapMarineLife)
      : mapMarineLife;
    const powerUpsFromCache = ENABLE_COHERENCE_BACKEND
      ? await readCacheEntries(mapPowerUps)
      : mapPowerUps;
    socket.emit("items.all", { ...trashFromCache, ...marineLifeFromCache, ...powerUpsFromCache });

    // TODO: Implement spatial scoping for players (e.g., using rooms based on grid positions)
    // For now, emitting to all - optimization needed for large player counts
    socket.emit(
      "player.info.all",
      ENABLE_COHERENCE_BACKEND
        ? await readCacheEntries(mapPlayersInfo)
        : mapPlayersInfo
    );

    socket.emit("game.state", gameState);

    if (gameState === 'RUNNING' && gameStartTime) {
      const startX = Math.round((Math.random() - 0.5) * (WORLD_SIZE_X - 1));
      const startZ = Math.round((Math.random() - 0.5) * (WORLD_SIZE_Z - 1));
      socket.emit("game.on", { startPosition: { x: startX, y: 0, z: startZ } });
      const elapsed = Date.now() - gameStartTime;
      const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
      socket.emit("game.time", Math.max(0, Math.round(remaining / 1000)));
    } else if (gameState === 'STARTING' && gameStartingAt) {
      socket.emit("startingGame", { startsAt: gameStartingAt, countdownMs: Math.max(0, gameStartingAt - Date.now()) });
    }


    socket.on("player.info.joining", async ({ id, name }) => {
      // Track the playerId bound to this socket for chat attribution/throttling
      playerIdForSocket = id;
      if (ENABLE_COHERENCE_BACKEND) {
        await writeCache(mapPlayersInfo, id, { name });
      } else {
        mapPlayersInfo[id] = { name };
      }
      // Seed chat history to the newly joined lobby client
      socket.emit("chat.history", chatHistory);
      // Broadcast updated lobby roster
      io.emit(
        "lobby.players",
        ENABLE_COHERENCE_BACKEND ? await readCacheEntries(mapPlayersInfo) : mapPlayersInfo
      );
      await emitPlayerCount();
    });

    socket.on("game.start", async ({ playerId, playerName }) => {
      playerIdForSocket = playerId;
      mapPlayerSockets[playerId] = socket;
      const body = { name: playerName };
      if (ENABLE_COHERENCE_BACKEND) {
        await writeCache(mapPlayersInfo, playerId, body);
      } else {
        mapPlayersInfo[playerId] = body;
      }
      io.emit("player.info.joined", {
        id: playerId,
        name: playerName,
      });
      await emitPlayerCount();

      // Initialize authoritative state for late joiners when a match is already RUNNING
      if (SERVER_AUTH_ENABLED && gameState === 'RUNNING' && !playersState.has(playerId)) {
        const startX = Math.round((Math.random() - 0.5) * (WORLD_SIZE_X - 1));
        const startZ = Math.round((Math.random() - 0.5) * (WORLD_SIZE_Z - 1));
        playersState.set(playerId, {
          x: startX,
          y: 0,
          z: startZ,
          rotY: 0,
          vel: 0,
          speedMul: 1,
          shield: false,
          effects: { speedUntil: 0, shieldUntil: 0 }
        });
        playersInput.set(playerId, { throttle: 0, steer: 0, brake: false, lastSeq: -1 });
      }
    });

    socket.on("player.trace.change", async ({ id, ...traceData }) => {
      const body = { ...traceData, updated: new Date() };
      if (ENABLE_COHERENCE_BACKEND) {
        await writeCache(mapPlayersTraces, id, body);
      } else {
        mapPlayersTraces[id] = body;
      }
    });

    // Server-authoritative input stream (optional; gated by env flag)
    socket.on("player.input", ({ id, seq, throttle = 0, steer = 0, brake = false }) => {
      try {
        if (!SERVER_AUTH_ENABLED) return;
        // Bind to this socket's player id if present, drop spoofed ids
        if (playerIdForSocket && id !== playerIdForSocket) return;
        const prev = playersInput.get(id) || { lastSeq: -1 };
        if (typeof seq !== "number" || seq <= (prev.lastSeq ?? -1)) return;
        const t = Math.max(-1, Math.min(1, Number(throttle) || 0));
        const s = Math.max(-1, Math.min(1, Number(steer) || 0));
        playersInput.set(id, { throttle: t, steer: s, brake: !!brake, lastSeq: seq });
      } catch (e) {
        logger.error(`player.input error: ${e && e.message ? e.message : e}`);
      }
    });

    socket.on("items.collision", async ({ itemId, playerId, playerName }) => {
      try {
        // Locate the item and its type
        let item = null;
        let itemType = null;
        if (ENABLE_COHERENCE_BACKEND) {
          if (await mapTrash.has(itemId)) {
            itemType = "trash";
            item = await readCache(mapTrash, itemId);
          } else if (await mapMarineLife.has(itemId)) {
            itemType = "turtle";
            item = await readCache(mapMarineLife, itemId);
          } else if (await mapPowerUps.has(itemId)) {
            itemType = "powerup";
            item = await readCache(mapPowerUps, itemId);
          }
        } else {
          if (mapTrash[itemId]) {
            itemType = "trash";
            item = mapTrash[itemId];
          } else if (mapMarineLife[itemId]) {
            itemType = "turtle";
            item = mapMarineLife[itemId];
          } else if (mapPowerUps[itemId]) {
            itemType = "powerup";
            item = mapPowerUps[itemId];
          }
        }

        if (!item) return;

        // If server-authoritative, validate proximity using authoritative state
        if (SERVER_AUTH_ENABLED) {
          const st = playersState.get(playerId);
          if (!st) return;
          const ipos = item.position || { x: 0, z: 0 };
          const dx = (st.x || 0) - ipos.x;
          const dz = (st.z || 0) - ipos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > COLLISION_VALIDATE_RADIUS) {
            // Ignore spoofed/late collisions
            return;
          }
        }

        // Remove the item, update score/effects accordingly
        if (itemType === "trash") {
          if (ENABLE_COHERENCE_BACKEND) {
            await deleteCache(mapTrash, itemId);
          } else {
            delete mapTrash[itemId];
          }
          io.emit("item.destroy", itemId);
          if (item) itemPool.returnObject(item);
          await postCurrentScore(playerId, playerName, "INCREMENT");
        } else if (itemType === "turtle") {
          if (ENABLE_COHERENCE_BACKEND) {
            await deleteCache(mapMarineLife, itemId);
          } else {
            delete mapMarineLife[itemId];
          }
          io.emit("item.destroy", itemId);
          if (item) itemPool.returnObject(item);
          // If shielded under authority, do not decrement
          if (!SERVER_AUTH_ENABLED || !(playersState.get(playerId)?.shield)) {
            await postCurrentScore(playerId, playerName, "DECREMENT");
          }
        } else {
          // Power-ups
          if (ENABLE_COHERENCE_BACKEND) {
            await deleteCache(mapPowerUps, itemId);
          } else {
            delete mapPowerUps[itemId];
          }
          io.emit("item.destroy", itemId);
          if (item) itemPool.returnObject(item);

          if (SERVER_AUTH_ENABLED) {
            const st = playersState.get(playerId) || {
              x: 0,
              y: 0,
              z: 0,
              rotY: 0,
              vel: 0,
              speedMul: 1,
              shield: false,
              effects: { speedUntil: 0, shieldUntil: 0 }
            };
            // Distinguish type by stored item.type if present
            const typeName = (item.type && String(item.type)) || "";
            if (typeName === "powerup_speed") {
              st.speedMul = POWERUP_SPEED_MULTIPLIER;
              st.effects = st.effects || {};
              st.effects.speedUntil = Date.now() + POWERUP_SPEED_DURATION_MS;
            } else if (typeName === "powerup_shield") {
              st.shield = true;
              st.effects = st.effects || {};
              st.effects.shieldUntil = Date.now() + POWERUP_SHIELD_DURATION_MS;
            }
            playersState.set(playerId, st);
          }
        }
      } catch (e) {
        logger.error(`items.collision error: ${e && e.message ? e.message : e}`);
      }
    });
    
    // Lobby chat: receive text, validate/throttle, store, and broadcast
    socket.on("chat.send", ({ text }) => {
      try {
        if (typeof text !== "string") return;
        const trimmed = text.trim();
        if (!trimmed) return;
        if (trimmed.length > 300) return;
        const now = Date.now();
        // Simple per-socket throttle: 1 message every 2 seconds
        if (!socket.data) socket.data = {};
        if (socket.data.lastChatTs && now - socket.data.lastChatTs < 2000) return;
        socket.data.lastChatTs = now;

        const id = playerIdForSocket;
        const name =
          mapPlayersInfo && id && mapPlayersInfo[id] && mapPlayersInfo[id].name
            ? mapPlayersInfo[id].name
            : "Player";

        const msg = { id, name, text: trimmed, ts: now };
        chatHistory.push(msg);
        if (chatHistory.length > CHAT_HISTORY_LIMIT) chatHistory.shift();
        io.emit("chat.message", msg);
      } catch (e) {
        logger.error(`chat.send error: ${e && e.message ? e.message : e}`);
      }
    });

    socket.on("disconnect", async (reason) => {
      io.emit("player.info.left", playerIdForSocket);
      if (ENABLE_COHERENCE_BACKEND) {
        await deleteCache(mapPlayersTraces, playerIdForSocket);
        await deleteCache(mapPlayersInfo, playerIdForSocket);
      } else {
        delete mapPlayersTraces[playerIdForSocket];
        delete mapPlayersInfo[playerIdForSocket];
      }
      if (playerIdForSocket && mapPlayerSockets[playerIdForSocket]) {
        delete mapPlayerSockets[playerIdForSocket];
      }
      // Remove authoritative state/input if present
      playersState.delete(playerIdForSocket);
      playersInput.delete(playerIdForSocket);

      // Broadcast updated lobby roster after removal
      io.emit(
        "lobby.players",
        ENABLE_COHERENCE_BACKEND ? await readCacheEntries(mapPlayersInfo) : mapPlayersInfo
      );
      logger.info(`${playerIdForSocket} disconnected because ${reason}`);
      await emitPlayerCount();
      playerIdForSocket = undefined;
    });

    socket.on("admin.start", () => {
      if (gameState !== 'WAITING') return;
      gameState = 'STARTING';
      io.emit("game.state", gameState);
      // Broadcast fresh server info and synchronized countdown
      gameStartingAt = Date.now() + 10000;
      io.emit("server.info", {
        id: serverId,
        version: version,
        gameDuration: GAME_DURATION_IN_SECONDS,
        worldSizeX: WORLD_SIZE_X,
        worldSizeZ: WORLD_SIZE_Z,
        serverAuthEnabled: SERVER_AUTH_ENABLED,
        physics: PHYSICS_CONFIG,
      });
      io.emit("startingGame", { startsAt: gameStartingAt, countdownMs: 10000 });
      setTimeout(() => {
        gameState = 'RUNNING';
        io.emit("game.state", gameState);
        gameStartingAt = null;
        Object.keys(mapPlayerSockets).forEach((playerId) => {
          const socket = mapPlayerSockets[playerId];
          const startX = Math.round((Math.random() - 0.5) * (WORLD_SIZE_X - 1));
          const startZ = Math.round((Math.random() - 0.5) * (WORLD_SIZE_Z - 1));
          socket.emit("game.on", { startPosition: { x: startX, y: 0, z: startZ } });
          // Initialize authoritative state and inputs
          if (SERVER_AUTH_ENABLED) {
            playersState.set(playerId, {
              x: startX,
              y: 0,
              z: startZ,
              rotY: 0,
              vel: 0,
              speedMul: 1,
              shield: false,
              effects: { speedUntil: 0, shieldUntil: 0 }
            });
            playersInput.set(playerId, { throttle: 0, steer: 0, brake: false, lastSeq: -1 });
          }
        });
        gameStartTime = Date.now();

        // Seed initial items and power-ups immediately for visibility
        (async () => {
          const numPlayersNow = ENABLE_COHERENCE_BACKEND ? await mapPlayersInfo.size() : Object.keys(mapPlayersInfo).length;

          // Trash
          for (let i = 0; i < Math.max(1, numPlayersNow); i++) {
            const obj = itemPool.getObject();
            if (obj) {
              obj.type = 'trash';
              io.emit('item.new', { id: obj.id, data: obj });
              ENABLE_COHERENCE_BACKEND ? await writeCache(mapTrash, obj.id, obj) : (mapTrash[obj.id] = obj);
            }
          }

          // Marine life
          for (let i = 0; i < Math.max(2, numPlayersNow * 2); i++) {
            const obj = itemPool.getObject();
            if (obj) {
              obj.type = 'turtle';
              io.emit('item.new', { id: obj.id, data: obj });
              ENABLE_COHERENCE_BACKEND ? await writeCache(mapMarineLife, obj.id, obj) : (mapMarineLife[obj.id] = obj);
            }
          }

          // Power-ups
          const puCount = Math.min(2, numPlayersNow);
          for (let i = 0; i < puCount; i++) {
            const obj = itemPool.getObject();
            if (obj) {
              obj.type = i % 2 === 0 ? 'powerup_speed' : 'powerup_shield';
              io.emit('item.new', { id: obj.id, data: obj });
              ENABLE_COHERENCE_BACKEND ? await writeCache(mapPowerUps, obj.id, obj) : (mapPowerUps[obj.id] = obj);
            }
          }
        })();

        gameTimer = setInterval(() => {
          const elapsed = Date.now() - gameStartTime;
          const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
          io.emit("game.time", Math.max(0, Math.round(remaining / 1000)));
          if (remaining <= 0) {
            clearInterval(gameTimer);
            gameState = 'ENDED';
            io.emit("game.state", gameState);
            io.emit("game.end");
            Object.keys(mapPlayerSockets).forEach(async (playerId) => {
              const socket = mapPlayerSockets[playerId];
              socket.emit("game.end", { playerId });
              io.emit("player.info.left", playerId);
              if (ENABLE_COHERENCE_BACKEND) {
                await deleteCache(mapPlayersTraces, playerId);
                await deleteCache(mapPlayersInfo, playerId);
              } else {
                delete mapPlayersTraces[playerId];
                delete mapPlayersInfo[playerId];
              }
              await deleteCurrentScore(playerId);
            });
            mapPlayerSockets = {};
            setTimeout(() => {
              gameState = 'WAITING';
              io.emit("game.state", gameState);
              emitPlayerCount();
            }, 10000);
          }
        }, 1000);
      }, 10000);
    });

    socket.on("admin.end", () => {
      if (gameState !== 'RUNNING' && gameState !== 'STARTING') return;
      if (gameTimer) clearInterval(gameTimer);
      gameState = 'ENDED';
      io.emit("game.state", gameState);
      io.emit("game.end");
      Object.keys(mapPlayerSockets).forEach(async (playerId) => {
        const socket = mapPlayerSockets[playerId];
        socket.emit("game.end", { playerId });
        io.emit("player.info.left", playerId);
        if (ENABLE_COHERENCE_BACKEND) {
          await deleteCache(mapPlayersTraces, playerId);
          await deleteCache(mapPlayersInfo, playerId);
        } else {
          delete mapPlayersTraces[playerId];
          delete mapPlayersInfo[playerId];
        }
        await deleteCurrentScore(playerId);
      });
      mapPlayerSockets = {};
      emitPlayerCount();
      gameStartingAt = null;
      setTimeout(() => {
        gameState = 'WAITING';
        io.emit("game.state", gameState);
        emitPlayerCount();
      }, 10000);
    });
  });

  io.engine.on("connection_error", async (err) => {
    logger.error(`ERROR ${err.code}: ${err.message}; ${err.context}`);
  });

  // Server-authoritative simulation and state broadcast (optional)
  if (SERVER_AUTH_ENABLED) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const WORLD_HALF_X = WORLD_SIZE_X / 2;
    const WORLD_HALF_Z = WORLD_SIZE_Z / 2;

    const step = (dt) => {
      const now = Date.now();
      for (const [id, state] of playersState.entries()) {
        const input = playersInput.get(id) || { throttle: 0, steer: 0, brake: false };

        // effects expiry
        if (state.effects) {
          if (state.effects.speedUntil && now > state.effects.speedUntil) {
            state.speedMul = 1;
            state.effects.speedUntil = 0;
          }
          if (state.effects.shieldUntil && now > state.effects.shieldUntil) {
            state.shield = false;
            state.effects.shieldUntil = 0;
          }
        }

        // integrate
        const acc = PHYSICS_CONFIG.acceleration;
        const brakeAcc = PHYSICS_CONFIG.brake;
        const friction = PHYSICS_CONFIG.friction;
        const turnSpeed = PHYSICS_CONFIG.turnSpeed;
        const maxSpeed = PHYSICS_CONFIG.maxSpeed * (state.speedMul || 1);

        state.vel = (state.vel || 0) + (input.throttle || 0) * acc * dt;
        if (input.brake) state.vel -= brakeAcc * dt;

        state.vel *= Math.exp(-friction * dt);
        state.vel = clamp(state.vel, -maxSpeed, maxSpeed);

        state.rotY = (state.rotY || 0) + (input.steer || 0) * turnSpeed * dt;

        const dx = Math.sin(state.rotY) * state.vel * dt;
        const dz = Math.cos(state.rotY) * state.vel * dt;
        state.x = clamp((state.x ?? 0) + dx, -WORLD_HALF_X, WORLD_HALF_X);
        state.z = clamp((state.z ?? 0) + dz, -WORLD_HALF_Z, WORLD_HALF_Z);

        playersState.set(id, state);
      }
    };

    const snapshot = () => {
      const states = {};
      for (const [id, s] of playersState.entries()) {
        states[id] = { x: s.x || 0, z: s.z || 0, rotY: s.rotY || 0, speed: s.vel || 0 };
      }
      return { t: Date.now(), states };
    };

    let lastTick = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0.001, (now - lastTick) / 1000);
      lastTick = now;
      step(dt);
    }, Math.max(1, Math.round(1000 / Math.max(1, SIM_TPS))));

    setInterval(() => {
      io.emit("player.state", snapshot());
    }, Math.max(1, Math.round(1000 / Math.max(1, STATE_BROADCAST_HZ))));
  }

  // broadcast all players traces
  setInterval(async () => {
    // TODO: Implement spatial scoping (e.g., broadcast to nearby players only)
    // For now, emitting to all
    const traces = ENABLE_COHERENCE_BACKEND
      ? await readCacheEntries(mapPlayersTraces)
      : mapPlayersTraces;
    io.emit("player.trace.all", traces);
  }, BROADCAST_REFRESH_UPDATE);

  // refresh items
  setInterval(async () => {
    const numPlayers = ENABLE_COHERENCE_BACKEND
      ? await mapPlayersInfo.size()
      : Object.keys(mapPlayersInfo).length;
    const numTrash = ENABLE_COHERENCE_BACKEND
      ? await mapTrash.size()
      : Object.keys(mapTrash).length;
    const numMarineLife = ENABLE_COHERENCE_BACKEND
      ? await mapMarineLife.size()
      : Object.keys(mapMarineLife).length;

    const deltaTrash = numPlayers - numTrash;
    const deltaMarineLife = numPlayers * 2 - numMarineLife;

    for (let i = 0; i < deltaTrash; i++) {
      const obj = itemPool.getObject();
      if (obj) {
        obj.type = 'trash';
        io.emit('item.new', { id: obj.id, data: obj });
        ENABLE_COHERENCE_BACKEND
          ? await writeCache(mapTrash, obj.id, obj)
          : (mapTrash[obj.id] = obj);
      }
    }

    for (let i = 0; i < deltaMarineLife; i++) {
      const obj = itemPool.getObject();
      if (obj) {
        obj.type = 'turtle';
        io.emit('item.new', { id: obj.id, data: obj });
        ENABLE_COHERENCE_BACKEND
          ? await writeCache(mapMarineLife, obj.id, obj)
          : (mapMarineLife[obj.id] = obj);
      }
    }
  }, BROADCAST_ITEMS_IN_SECONDS * 1000);


  // Spawn power-ups (target: up to 1 per player, check every 60s)
  setInterval(async () => {
    const numPlayers = ENABLE_COHERENCE_BACKEND
      ? await mapPlayersInfo.size()
      : Object.keys(mapPlayersInfo).length;
    const numPowerUps = ENABLE_COHERENCE_BACKEND
      ? await mapPowerUps.size()
      : Object.keys(mapPowerUps).length;

    const target = numPlayers; // simple target: 1 active power-up per player
    const toAdd = Math.max(0, target - numPowerUps);
    for (let i = 0; i < toAdd; i++) {
      const obj = itemPool.getObject();
      if (obj) {
        // Alternate types; extend with more types as needed
        obj.type = i % 2 === 0 ? "powerup_speed" : "powerup_shield";
        io.emit("item.new", { id: obj.id, data: obj });
        if (ENABLE_COHERENCE_BACKEND) {
          await writeCache(mapPowerUps, obj.id, obj);
        } else {
          mapPowerUps[obj.id] = obj;
        }
      }
    }
  }, 60000);

  // Clean stale players, and send delete player if stale
  setInterval(async () => {
    const now = new Date();
    // TODO: Optimize stale detection; investigate Coherence TTL for automatic expiration
    // Currently adding elapsed to check; consider if cleanup is necessary or can be handled by disconnect events
    const traces = ENABLE_COHERENCE_BACKEND
      ? await readCacheEntries(mapPlayersTraces)
      : mapPlayersTraces;
    const elapsedTimesById = Object.entries(traces).map((player) => ({
      id: player[0],
      elapsed: now - player[1].updated,
    }));
    const staleIds = elapsedTimesById.filter((e) => e.elapsed > 250);
    staleIds.forEach(async (p) => {
      logger.info(`Stale player ${p.id} by ${p.elapsed}ms`);
      if (ENABLE_COHERENCE_BACKEND) {
        await deleteCache(mapPlayersTraces, p.id);
        await deleteCache(mapPlayersInfo, p.id);
      } else {
        delete mapPlayersTraces[p.id];
        delete mapPlayersInfo[p.id];
      }

      io.emit('player.info.left', p.id);
    });
    emitPlayerCount();
  }, CLEANUP_STALE_IN_SECONDS * 1000);

  setInterval(async () => {
    const numPlayers = ENABLE_COHERENCE_BACKEND
      ? await mapPlayersInfo.size()
      : Object.keys(mapPlayersInfo).length;
    const numTrash = ENABLE_COHERENCE_BACKEND
      ? await mapTrash.size()
      : Object.keys(mapTrash).length;
    const numMarineLife = ENABLE_COHERENCE_BACKEND
      ? await mapMarineLife.size()
      : Object.keys(mapMarineLife).length;
    logger.info(
      `${numPlayers} Players, ${numTrash} Trash items and ${numMarineLife} Marine Life`
    );
  }, 5000);

  setInterval(() => {
    emitPlayerCount();
  }, 5000);

  httpServer.listen(port, () =>
    logger.info(`Server listening to port ${port}`)
  );
}

async function writeCache(cache, id, value) {
  try {
    await cache.set(id, value);
  } catch (error) {
    logger.error(
      `Error writing ${id}: ${JSON.stringify(value)}. ${error.message}`
    );
  }
}

async function readCache(cache, id) {
  try {
    return await cache.get(id);
  } catch (error) {
    logger.error(`Error reading ${id}. ${error.message}`);
  }
}

async function deleteCache(cache, id) {
  if (!id) return;
  try {
    await cache.delete(id);
  } catch (error) {
    logger.error(`Error deleting ${id}. ${error.message}`);
  }
}

async function readCacheEntries(cache) {
  try {
    const response = await cache.entries();
    let data = {};
    for await (const entry of response) {
      data[entry.key] = entry.value;
    }
    return data;
  } catch (error) {
    logger.error(`Error reading all entries. ${error.message}`);
  }
}
