import { Server } from "socket.io";
import * as dotenv from "dotenv";
import short from "short-uuid";
import pino from "pino";
import { deleteCurrentScore, postCurrentScore } from "./score.js";
import pkg from "./package.json" with { type: "json" };
import ObjectPool from './object-pool.js';
import { updateRuntimeMetrics } from "./metrics.js";
import { buildCommentary, deterministicCommentary, recordGameEvent, recordPlayerSessionProfile, summarizeSession } from "./lib/gameEvents.js";
import { createCoherenceAdapter } from "./lib/coherenceSocketAdapter.js";
import {
  resolveRealtimeBackend,
  shouldUseCoherence,
  socketBusConfigFromEnv,
} from "./lib/realtimeBackend.js";
import { createCoherenceEntryReader } from "./lib/coherenceScan.js";
import { reinitializeItemForSpawn, snapshotItemForEvent } from "./lib/itemLifecycle.js";
import {
  buildPlayerSessionProfile,
  resolveJoiningRoom,
  resolveAuthoritativeBoatTypes,
  chooseSpawnPositionAwayFromPlayers,
  buildStartPositionItemRelocations,
  buildOpeningCollectiblePositions,
  countMirroredMapEntries,
  resolveCollisionValidateRadius,
  resolveItemCollisionRadius,
  resolvePickupTouchForgiveness,
  resolveServerAuthSpeedLimit,
} from "./lib/gameLogic.js";

dotenv.config();
dotenv.config({ path: "config/.env" });
dotenv.config({ path: "../.config/.env" });

const isProduction = process.env.NODE_ENV === "production";
const logger = pino({ level: isProduction ? "warn" : "debug" });

function logAsyncFailure(context, error) {
  logger.error(
    {
      context,
      err: {
        name: error?.name,
        message: error?.message || String(error),
        code: error?.code,
        details: error?.details,
        stack: error?.stack,
      },
    },
    `${context} failed`
  );
}

function runAsyncTask(context, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => logAsyncFailure(context, error));
}

function setAsyncInterval(context, task, delayMs) {
  return setInterval(() => runAsyncTask(context, task), delayMs);
}

process.on("unhandledRejection", (reason) => {
  logAsyncFailure("unhandledRejection", reason);
});

process.on("uncaughtExceptionMonitor", (error) => {
  logAsyncFailure("uncaughtExceptionMonitor", error);
});

const version = pkg.version;
logger.info(`Server version ${version}`);
const serverId = short.generate();
logger.info(`Server ${serverId}`);

const DEFAULT_REALTIME_CLUSTER_BACKEND = resolveRealtimeBackend(process.env);
const ENABLE_COHERENCE_BACKEND = shouldUseCoherence(process.env);

const BROADCAST_REFRESH_UPDATE = process.env.BROADCAST_REFRESH_UPDATE
  ? parseInt(process.env.BROADCAST_REFRESH_UPDATE)
  : 50;

const CLEANUP_STALE_IN_SECONDS = process.env.CLEANUP_STALE_IN_SECONDS
  ? parseInt(process.env.CLEANUP_STALE_IN_SECONDS)
  : 2;
const BROADCAST_ITEMS_IN_SECONDS = process.env.BROADCAST_ITEMS_IN_SECONDS
  ? parseInt(process.env.BROADCAST_ITEMS_IN_SECONDS)
  : 2;
const ITEMS_REFRESH_MS = parseInt(process.env.ITEMS_REFRESH_MS ?? "250");
const SPAWN_REFILL_HORIZON_SEC = parseFloat(process.env.SPAWN_REFILL_HORIZON_SEC ?? "0.5");
const SPAWN_MAX_PER_TICK_TRASH = parseInt(process.env.SPAWN_MAX_PER_TICK_TRASH ?? "50");
const SPAWN_MAX_PER_TICK_MARINE = parseInt(process.env.SPAWN_MAX_PER_TICK_MARINE ?? "50");
const POWERUP_REFRESH_MS = parseInt(process.env.POWERUP_REFRESH_MS ?? "1500");
const METRICS_BROADCAST_MS = parseInt(process.env.METRICS_BROADCAST_MS ?? (isProduction ? "1000" : "300"));
const COHERENCE_SCAN_TIMEOUT_MS = parseInt(process.env.COHERENCE_SCAN_TIMEOUT_MS ?? "2500");
const COHERENCE_SCAN_BACKOFF_MS = parseInt(process.env.COHERENCE_SCAN_BACKOFF_MS ?? "60000");
const DEMO_ADMIN_TOKEN = process.env.DEMO_ADMIN_TOKEN || process.env.ADMIN_DEMO_TOKEN || "";
const SPAWN_PLAYER_CLEAR_RADIUS = process.env.SPAWN_PLAYER_CLEAR_RADIUS
  ? parseFloat(process.env.SPAWN_PLAYER_CLEAR_RADIUS)
  : 4;
const START_POSITION_ITEM_CLEAR_RADIUS = process.env.START_POSITION_ITEM_CLEAR_RADIUS
  ? parseFloat(process.env.START_POSITION_ITEM_CLEAR_RADIUS)
  : Math.max(6, SPAWN_PLAYER_CLEAR_RADIUS);
const OPENING_TRASH_COUNT = process.env.OPENING_TRASH_COUNT
  ? parseInt(process.env.OPENING_TRASH_COUNT)
  : 3;
const OPENING_TRASH_RADIUS = process.env.OPENING_TRASH_RADIUS
  ? parseFloat(process.env.OPENING_TRASH_RADIUS)
  : Math.max(8, START_POSITION_ITEM_CLEAR_RADIUS + 1.5);
const OPENING_TRASH_MIN_SPACING = process.env.OPENING_TRASH_MIN_SPACING
  ? parseFloat(process.env.OPENING_TRASH_MIN_SPACING)
  : 3.5;

const ITEM_MAX_SIZE = process.env.ITEM_MAX_SIZE
  ? parseFloat(process.env.ITEM_MAX_SIZE)
  : 0.9;
const ITEM_MIN_SIZE = process.env.ITEM_MIN_SIZE
  ? parseFloat(process.env.ITEM_MIN_SIZE)
  : 0.5;

const WORLD_SIZE_X = process.env.WORLD_SIZE_X
  ? parseInt(process.env.WORLD_SIZE_X)
  : 128;
const WORLD_SIZE_Z = process.env.WORLD_SIZE_Z
  ? parseInt(process.env.WORLD_SIZE_Z)
  : 42;

let worldSizeX = WORLD_SIZE_X;
let worldSizeZ = WORLD_SIZE_Z;

const SPAWN_SPREAD = parseFloat(process.env.WORLD_SPAWN_SPREAD || "0.6");
function randSpawnCoord(size) {
  const spread = Math.max(0.1, Math.min(1, SPAWN_SPREAD));
  return Math.round((Math.random() - 0.5) * (size * spread - 1));
}

/* Spawn scaler mode and params (runtime adjustable via admin.*)
   Default to "fibonacci" as requested, unless overridden by env (SPAWN_SCALER). */
let spawnMode = process.env.SPAWN_SCALER || "fibonacci";
let spawnParams = {
  k: parseFloat(process.env.SPAWN_PROP_K ?? "1"),
  tr: parseFloat(process.env.SPAWN_PROP_R_TRASH ?? "1"),
  mr: parseFloat(process.env.SPAWN_PROP_R_MARINE ?? "2"),
  pr: parseFloat(process.env.SPAWN_PROP_R_PU ?? "0.2"),
  fibTTrash: parseInt(process.env.SPAWN_FIB_T_TRASH ?? "3"),
  fibTMarine: parseInt(process.env.SPAWN_FIB_T_MARINE ?? "4"),
  fibTPU: parseInt(process.env.SPAWN_FIB_T_PU ?? "2"),
  clampTrash: parseInt(process.env.SPAWN_CLAMP_TRASH ?? "500"),
  clampMarine: parseInt(process.env.SPAWN_CLAMP_MARINE ?? "1000"),
  clampPU: parseInt(process.env.SPAWN_CLAMP_PU ?? "50"),
};

// Difficulty scaler config
const DIFFICULTY_INTERVAL_MS = parseInt(process.env.DIFFICULTY_INTERVAL_MS ?? "10000");
const SPAWN_EXTRA_PER_STEP = parseInt(process.env.SPAWN_EXTRA_PER_STEP ?? "2");
const SPAWN_EXTRA_PER_PLAYER = parseFloat(process.env.SPAWN_EXTRA_PER_PLAYER ?? "1");

let difficultyLevel = 0;
let lastDifficultyAt = Date.now();

function computeEffectiveTargets(humans) {
  const base = computeTargets(humans);
  const perPlayer = Math.max(0, humans - 1) * SPAWN_EXTRA_PER_PLAYER;
  const extra = Math.max(0, Math.floor(difficultyLevel * SPAWN_EXTRA_PER_STEP + perPlayer));
  return {
    trash: clampNum(base.trash + extra, 0, spawnParams.clampTrash || 500),
    marine: clampNum(base.marine + Math.ceil(extra * 0.8), 0, spawnParams.clampMarine || 1000),
    powerups: base.powerups
  };
}

// Dynamic world scaling config
let worldScaleCfg = {
  minX: parseInt(process.env.WORLD_MIN_X ?? String(Math.round(WORLD_SIZE_X * 0.5))),
  minZ: parseInt(process.env.WORLD_MIN_Z ?? String(Math.round(WORLD_SIZE_Z * 0.5))),
  maxX: parseInt(process.env.WORLD_MAX_X ?? String(Math.round(WORLD_SIZE_X * 2))),
  maxZ: parseInt(process.env.WORLD_MAX_Z ?? String(Math.round(WORLD_SIZE_Z * 4))),
  baseX: parseInt(process.env.WORLD_BASE_X ?? String(WORLD_SIZE_X)),
  baseZ: parseInt(process.env.WORLD_BASE_Z ?? String(WORLD_SIZE_Z)),
  basePlayers: parseInt(process.env.WORLD_BASE_PLAYERS ?? "4"),
};

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function fib(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

function computeTargets(humans) {
  humans = Math.max(0, parseInt(humans || 0));
  const p = humans;
  let targetTrash = 0, targetMarine = 0, targetPU = 0;
  if (spawnMode === "fibonacci") {
    const baseAdd = 1;
    targetTrash = baseAdd + fib(p + (spawnParams.fibTTrash || 0));
    targetMarine = baseAdd + fib(p + (spawnParams.fibTMarine || 0));
    targetPU = baseAdd + Math.min(p, fib(Math.max(0, p + (spawnParams.fibTPU || 0))));
  } else {
    const k = spawnParams.k || 1;
    targetTrash = Math.ceil(k * p * (spawnParams.tr || 1));
    targetMarine = Math.ceil(k * p * (spawnParams.mr || 2));
    targetPU = Math.ceil(k * p * (spawnParams.pr || 0.2));
  }
  targetTrash = clampNum(targetTrash, 0, spawnParams.clampTrash || 500);
  targetMarine = clampNum(targetMarine, 0, spawnParams.clampMarine || 1000);
  targetPU = clampNum(targetPU, 0, spawnParams.clampPU || 50);
  return { trash: targetTrash, marine: targetMarine, powerups: targetPU };
}

function recomputeWorldSize(humans) {
  const p = Math.max(1, parseInt(humans || 1));
  const scale = Math.sqrt(p / Math.max(1, worldScaleCfg.basePlayers));
  const x = clampNum(Math.round(worldScaleCfg.baseX * scale), worldScaleCfg.minX, worldScaleCfg.maxX);
  const z = clampNum(Math.round(worldScaleCfg.baseZ * scale), worldScaleCfg.minZ, worldScaleCfg.maxZ);
  return { x, z };
}

let nextItemsSpawnAt = Date.now();

function tracePositionForPlayer(playerId, now = Date.now()) {
  const trace = ENABLE_COHERENCE_BACKEND
    ? localPlayerTraces[playerId]
    : mapPlayersTraces[playerId];
  if (!trace) return null;
  const updatedMs = trace.updated ? new Date(trace.updated).getTime() : 0;
  if (Number.isFinite(updatedMs) && updatedMs > 0 && now - updatedMs > Math.max(2500, BROADCAST_REFRESH_UPDATE * 6)) {
    return null;
  }
  const x = Number(trace.x);
  const z = Number(trace.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z, source: "trace" };
}

function collisionValidationPosition(playerId) {
  const fromTrace = tracePositionForPlayer(playerId);
  if (fromTrace) return fromTrace;
  if (SERVER_AUTH_ENABLED) {
    const st = playersState.get(playerId);
    if (!st) return null;
    return { x: Number(st.x || 0), z: Number(st.z || 0), source: "auth" };
  }
  return null;
}

function collisionClientPosition(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const halfX = Math.max(16, Number(worldSizeX || WORLD_SIZE_X || 0) / 2 + COLLISION_VALIDATE_RADIUS * 2);
  const halfZ = Math.max(16, Number(worldSizeZ || WORLD_SIZE_Z || 0) / 2 + COLLISION_VALIDATE_RADIUS * 2);
  if (Math.abs(x) > halfX || Math.abs(z) > halfZ) return null;
  return { x, z, source: "client" };
}

function collisionItemRadius(itemType, item = {}) {
  return resolveItemCollisionRadius(itemType, item);
}

function collisionBoatRadius(playerId) {
  const st = playersState.get(playerId);
  const typeConfig = BOAT_TYPES[st?.boatType || "speed"] || BOAT_TYPES.speed || {};
  const radius = Number(typeConfig.collisionRadius);
  return Number.isFinite(radius) && radius > 0 ? radius : 1.25;
}

function isBotProfile(profile = {}, id = "") {
  const name = profile && profile.name ? String(profile.name).trim().toLowerCase() : "";
  return !!(profile && profile.isBot) ||
    !!(profile && profile.botPolicy) ||
    !!(profile && profile.teacher) ||
    String(id || "").toLowerCase().startsWith("bot-") ||
    name.startsWith("bot ");
}

function countHumansAndBots(playersInfo = {}) {
  const ids = Object.keys(playersInfo || {});
  let bots = 0;
  ids.forEach((id) => {
    if (isBotProfile(playersInfo[id], id)) bots++;
  });
  return { total: ids.length, bots, humans: Math.max(0, ids.length - bots) };
}

function buildMetricsObject(playersInfo, counts, targets, roomStats = {}, socketStats = {}) {
  const { total, humans, bots } = countHumansAndBots(playersInfo);
  return {
    players: { total, humans, bots },
    sockets: {
      connections: Number.isFinite(socketStats.connections) ? socketStats.connections : 0,
    },
    rooms: {
      active: Number.isFinite(roomStats.active) ? roomStats.active : 0,
      waiting: Number.isFinite(roomStats.waiting) ? roomStats.waiting : 0,
      starting: Number.isFinite(roomStats.starting) ? roomStats.starting : 0,
      running: Number.isFinite(roomStats.running) ? roomStats.running : 0,
      ended: Number.isFinite(roomStats.ended) ? roomStats.ended : 0,
    },
    world: { x: worldSizeX, z: worldSizeZ },
    items: counts,
    targets,
    spawn: { mode: spawnMode, params: spawnParams, nextTickMs: Math.max(0, nextItemsSpawnAt - Date.now()) },
    serverAuthEnabled: SERVER_AUTH_ENABLED,
    tps: SIM_TPS,
    hz: STATE_BROADCAST_HZ
  };
}

const GAME_DURATION_IN_SECONDS = process.env.GAME_DURATION_IN_SECONDS
  ? parseInt(process.env.GAME_DURATION_IN_SECONDS)
  : 60;

const BOAT_TYPES = resolveAuthoritativeBoatTypes(process.env);

const PHYSICS_CONFIG = {
  acceleration: parseFloat(process.env.PHYS_ACCELERATION ?? "6"),
  brake: parseFloat(process.env.PHYS_BRAKE ?? "3"),
  maxSpeed: parseFloat(process.env.PHYS_MAX_SPEED ?? "3"),
  friction: parseFloat(process.env.PHYS_FRICTION ?? "1.5"),
  turnSpeed: parseFloat(process.env.PHYS_TURN_SPEED ?? "0.78"),
  driftFactor: parseFloat(process.env.PHYS_DRIFT ?? "0")
};

const SERVER_AUTH_ENABLED = process.env.SERVER_AUTH_ENABLED === "true";
const SIM_TPS = parseInt(process.env.SIM_TPS ?? "60");
const STATE_BROADCAST_HZ = parseInt(process.env.STATE_BROADCAST_HZ ?? "20");
const COLLISION_VALIDATE_RADIUS = resolveCollisionValidateRadius(process.env.COLLISION_VALIDATE_RADIUS);
const POWERUP_SPEED_MULTIPLIER = parseFloat(process.env.POWERUP_SPEED_MULTIPLIER ?? "2");
const SERVER_AUTH_MAX_SPEED_LIMIT = resolveServerAuthSpeedLimit(process.env.SERVER_AUTH_MAX_SPEED_LIMIT);
const POWERUP_SPEED_DURATION_MS = parseInt(process.env.POWERUP_SPEED_DURATION_MS ?? "10000");
const POWERUP_SHIELD_DURATION_MS = parseInt(process.env.POWERUP_SHIELD_DURATION_MS ?? "5000");
const POWERUP_MAGNET_DURATION_MS = parseInt(process.env.POWERUP_MAGNET_DURATION_MS ?? "8000");
const POWERUP_FREEZE_DURATION_MS = parseInt(process.env.POWERUP_FREEZE_DURATION_MS ?? "4000");
const POWERUP_MAGNET_RADIUS = parseFloat(process.env.POWERUP_MAGNET_RADIUS ?? "3.5");
const POWERUP_FREEZE_OTHER_MULT = parseFloat(process.env.POWERUP_FREEZE_OTHER_MULT ?? "0.45");
const PICKUP_TOUCH_FORGIVENESS = resolvePickupTouchForgiveness(process.env.PICKUP_TOUCH_FORGIVENESS);

 // Lobby chat (per-room buffer) and settings
 const CHAT_HISTORY_LIMIT = 100;
 const roomChats = new Map();
const COMMENTARY_HISTORY_LIMIT = 80;
const roomCommentaryHistory = new Map();
const pendingCommentaryTasks = new Map();
 // We reuse mapPlayersInfo as the lobby roster; emit 'lobby.players' when it changes.

let gameState = 'WAITING';
let gameStartTime = null;
let gameStartingAt = null;
let gameTimer = null;
const roomTimers = new Map(); // roomId -> { state, startTime, startingAt, timerId, resetTimerId }
const GLOBAL_ROOM = "__global__";
const pendingRoomRefills = new Map();

// Default room and rooms directory (authoritative on server)
const DEFAULT_ROOM_ID = (process.env.ROOM_DEFAULT_ID || "ROOM-0001").toUpperCase();

// Normalize room identifiers consistently
function normalizeRoom(r) {
  if (!r) return null;
  const s = String(r).trim().toUpperCase();
  if (!s) return null;
  // Keep A-Z 0-9 - _ and length clamp
  const cleaned = s.replace(/[^A-Z0-9\-_]/g, "").slice(0, 24);
  return cleaned || null;
}

function rememberRoomCommentary(room, payload = {}) {
  const key = normalizeRoom(room) || DEFAULT_ROOM_ID;
  const entry = {
    ...payload,
    room: key,
    at: payload.at || new Date().toISOString(),
  };
  const list = roomCommentaryHistory.get(key) || [];
  list.push(entry);
  while (list.length > COMMENTARY_HISTORY_LIMIT) list.shift();
  roomCommentaryHistory.set(key, list);
  return entry;
}

function commentaryHistoryForRoom(room) {
  const key = normalizeRoom(room) || DEFAULT_ROOM_ID;
  return [...(roomCommentaryHistory.get(key) || [])];
}

function commentaryTaskKey(sessionId, playerId) {
  return `${String(sessionId || "session")}::${String(playerId || "player")}`;
}

function fallbackCommentaryFromEvent(event = {}) {
  try {
    const summary = summarizeSession(event.session_id, event.player_id);
    return {
      summary,
      commentary: deterministicCommentary(summary),
      source: "deterministic-fallback",
    };
  } catch (error) {
    const score = Number.isFinite(Number(event.score)) ? Number(event.score) : 0;
    return {
      summary: {
        session_id: event.session_id,
        player_id: event.player_id,
        player_name: event.player_name,
        score,
      },
      commentary: `Game over recorded at ${score} points. Telemetry landed; commentary used the safe fallback.`,
      source: "deterministic-fallback",
      diagnostics: {
        warnings: [`commentary_fallback:${error && error.message ? error.message : String(error)}`],
      },
    };
  }
}

function queueGameOverCommentary(io, { room, event, playerName } = {}) {
  if (!event) return null;
  const safeRoom = normalizeRoom(room) || DEFAULT_ROOM_ID;
  const key = commentaryTaskKey(event.session_id, event.player_id);
  const pendingPayload = {
    status: "queued",
    room: safeRoom,
    session_id: event.session_id,
    player_id: event.player_id,
    player_name: playerName || event.player_name || "Player",
    score: event.score,
    source: "commentary-pending",
    at: new Date().toISOString(),
  };
  try { io.to(safeRoom).emit("commentary.pending", pendingPayload); } catch (_) {}
  if (pendingCommentaryTasks.has(key)) return pendingPayload;
  pendingCommentaryTasks.set(key, pendingPayload);
  runAsyncTask(`commentary.${key}`, async () => {
    let commentary;
    try {
      commentary = await buildCommentary(event.session_id, event.player_id);
    } catch (error) {
      logger.error(`commentary build failed for ${key}: ${error && error.message ? error.message : error}`);
      commentary = fallbackCommentaryFromEvent(event);
    } finally {
      pendingCommentaryTasks.delete(key);
    }
    const commentaryPayload = rememberRoomCommentary(safeRoom, {
      status: "ready",
      session_id: event.session_id,
      player_id: event.player_id,
      player_name: commentary?.summary?.player_name || playerName || event.player_name || "Player",
      score: commentary?.summary?.score ?? event.score,
      ...commentary,
    });
    io.to(safeRoom).emit("commentary.ready", commentaryPayload);
  });
  return pendingPayload;
}

function isLoadCanaryRoom(room) {
  return /^LOAD-[A-Za-z0-9-]+$/.test(String(room || ""));
}

function isLoadCanarySocket(socket) {
  const query = socket?.handshake?.query || {};
  const auth = socket?.handshake?.auth || {};
  return Boolean(
    query.stwlLoadRun ||
    query.stwl_load_run ||
    auth.stwlLoadRun ||
    auth.stwl_load_run
  );
}

// Directory cache (in-memory, optionally persisted via Coherence)
const roomDirectory = new Map();
let roomsUpdateTimer = null;

async function humansInRoomDirectory(room) {
  const want = room || GLOBAL_ROOM;
  if (isLoadCanaryRoom(want)) return 0;
  let info = {};
  try {
    info = ENABLE_COHERENCE_BACKEND && mapPlayersInfo
      ? await readCacheEntries(mapPlayersInfo)
      : (mapPlayersInfo || {});
  } catch (_) {
    info = {};
  }
  let humans = 0;
  for (const [id, v] of Object.entries(info || {})) {
    const profileRoom = v && v.room ? normalizeRoom(v.room) : null;
    const r = profileRoom || playerRooms.get(id) || DEFAULT_ROOM_ID;
    if (r !== want) continue;
    if (!isBotProfile(v, id)) humans++;
  }
  return humans;
}

async function buildRoomsPayload() {
  // Discover rooms: default + any with timers + any where players are present
  const set = new Set([DEFAULT_ROOM_ID]);
  for (const k of roomTimers.keys()) {
    if (!isLoadCanaryRoom(k)) set.add(k);
  }
  for (const [, r] of playerRooms.entries()) {
    const room = r || GLOBAL_ROOM;
    if (!isLoadCanaryRoom(room)) set.add(room);
  }
  try {
    const info = ENABLE_COHERENCE_BACKEND && mapPlayersInfo
      ? await readCacheEntries(mapPlayersInfo)
      : (mapPlayersInfo || {});
    for (const value of Object.values(info || {})) {
      const room = value && value.room ? normalizeRoom(value.room) : null;
      if (room && !isLoadCanaryRoom(room)) set.add(room);
    }
  } catch (_) {}

  const rooms = [];
  for (const id of set.values()) {
    const rs = roomTimers.get(id) || { state: 'WAITING', startTime: null, startingAt: null };
    const humans = await humansInRoomDirectory(id);
    const bots = 0; // optional: compute from player list if needed
    rooms.push({
      id,
      default: id === DEFAULT_ROOM_ID,
      state: rs.state,
      humans,
      bots,
      capacity: null,
      startsAt: rs.startingAt || null,
      startTime: rs.startTime || null,
      updatedAt: Date.now()
    });
  }
  return {
    default: DEFAULT_ROOM_ID,
    rooms,
    ts: Date.now()
  };
}

function scheduleRoomsUpdate(ioRef) {
  try { if (roomsUpdateTimer) clearTimeout(roomsUpdateTimer); } catch (_) {}
  roomsUpdateTimer = setTimeout(async () => {
    try {
      const payload = await buildRoomsPayload();
      ioRef.emit("rooms.update", payload);
    } catch (e) {
      logger.error(`rooms.update emit error: ${e && e.message ? e.message : e}`);
    }
  }, 250);
}

let mapPlayersTraces;
let mapPlayersInfo;
let mapTrash;
let mapMarineLife;
let mapPowerUps;
let mapRooms;
let mapPlayerSockets;
const localPlayersInfo = {};
const localPlayerTraces = {};
const localTrash = {};
const localMarineLife = {};
const localPowerUps = {};
const localRooms = {};
const coherenceEntryReader = createCoherenceEntryReader({
  timeoutMs: COHERENCE_SCAN_TIMEOUT_MS,
  backoffMs: COHERENCE_SCAN_BACKOFF_MS,
  logger,
});

const adminCmdSeen = new Map();
const ADMIN_CMD_TTL_MS = 2 * 60 * 1000;
function adminTrackDuplicate(id) {
  if (!id) return false;
  const now = Date.now();
  try {
    for (const [k, ts] of adminCmdSeen.entries()) {
      if (now - ts > ADMIN_CMD_TTL_MS) adminCmdSeen.delete(k);
    }
  } catch (_) {}
  if (adminCmdSeen.has(id)) return true;
  adminCmdSeen.set(id, now);
  return false;
}

function isPresenterCommandAuthorized(payload = {}) {
  if (!DEMO_ADMIN_TOKEN) return true;
  const supplied =
    payload.token ||
    payload.adminToken ||
    payload.presenterToken ||
    payload.demoAdminToken ||
    "";
  return String(supplied) === String(DEMO_ADMIN_TOKEN);
}

const playersState = new Map();
const playersInput = new Map();
const playerRooms = new Map();
// Per-room admin: the first human in a room becomes admin unless reassigned
const roomAdmin = new Map();

function sessionIdForRoom(room) {
  const wanted = room || GLOBAL_ROOM;
  const rs = roomTimers.get(wanted);
  const start = rs && rs.startTime ? rs.startTime : gameStartTime;
  return `${wanted}:${start || "pending"}`;
}

function createObject() {
  // Spawn nearer to the center by default so new players immediately see items.
  // Tunable via WORLD_SPAWN_SPREAD (0.1..1.0); default 0.6 (60% of world span).
  const spread = Math.max(0.1, Math.min(1, parseFloat(process.env.WORLD_SPAWN_SPREAD || "0.6")));
  const x = Math.round((Math.random() - 0.5) * (worldSizeX * spread - 1));
  const y = 0;
  const z = Math.round((Math.random() - 0.5) * (worldSizeZ * spread - 1));
  const size = (Math.random() * (ITEM_MAX_SIZE - ITEM_MIN_SIZE) + ITEM_MIN_SIZE).toFixed(2);
  return { 
    id: short.generate(), 
    type: 'unknown', 
    position: { x, y, z }, 
    size 
  };
}
const itemPool = new ObjectPool(createObject, 50, 1000);

function reinitItem(obj, type) {
  try {
    reinitializeItemForSpawn(obj, type, {
      idFactory: () => short.generate(),
      coordinateFactory: randSpawnCoord,
      worldSizeX,
      worldSizeZ,
      itemMinSize: ITEM_MIN_SIZE,
      itemMaxSize: ITEM_MAX_SIZE,
    });
  } catch (_) {
    /* ignore */
  }
}

function activePlayerPositionsForRoom(room) {
  const want = room || GLOBAL_ROOM;
  const positions = [];
  for (const [playerId, state] of playersState.entries()) {
    const playerRoom = playerRooms.get(playerId) || GLOBAL_ROOM;
    if (playerRoom !== want) continue;
    if (!state || !Number.isFinite(Number(state.x)) || !Number.isFinite(Number(state.z))) continue;
    positions.push({ x: Number(state.x), z: Number(state.z) });
  }
  return positions;
}

function reinitItemForRoom(obj, type, room) {
  reinitItem(obj, type);
  const safe = chooseSpawnPositionAwayFromPlayers({
    players: activePlayerPositionsForRoom(room),
    coordinateFactory: randSpawnCoord,
    worldSizeX,
    worldSizeZ,
    clearRadius: SPAWN_PLAYER_CLEAR_RADIUS,
  });
  obj.position = {
    x: safe.x,
    y: 0,
    z: safe.z,
  };
}

export async function start(
  httpServer,
  port,
  cacheSession,
  options = {}
) {
  const realtimeBackend = options.realtimeBackend || DEFAULT_REALTIME_CLUSTER_BACKEND;
  const socketBusConfig = options.socketBusConfig || socketBusConfigFromEnv(process.env);
  const io = new Server(httpServer, {
    pingInterval: 25000,
    pingTimeout: 20000,
    perMessageDeflate: { threshold: 1024 },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true
    }
  });

  if (realtimeBackend === "coherence") {
    if (!cacheSession) {
      throw new Error("coherence_realtime_backend_requires_cache_session");
    }
    const socketBusMap =
      typeof cacheSession.getCache === "function"
        ? await cacheSession.getCache(socketBusConfig.mapName)
        : await cacheSession.getMap(socketBusConfig.mapName);
    io.adapter(createCoherenceAdapter({
      busMap: socketBusMap,
      serverId,
      ttlMs: socketBusConfig.ttlMs,
      maxPayloadBytes: socketBusConfig.maxPayloadBytes,
      cleanupIntervalMs: 0,
      logger,
    }));
    logger.info(`Socket.IO Coherence bus enabled on map ${socketBusConfig.mapName}`);
  }

  const serverInfoPayload = () => ({
    id: serverId,
    version: version,
    gameDuration: GAME_DURATION_IN_SECONDS,
    worldSizeX: worldSizeX,
    worldSizeZ: worldSizeZ,
    serverAuthEnabled: SERVER_AUTH_ENABLED,
    physics: PHYSICS_CONFIG,
    boatTypes: BOAT_TYPES
  });

  if (ENABLE_COHERENCE_BACKEND) {
    mapPlayersTraces = await cacheSession.getMap("playerTraces");
    mapPlayersInfo = await cacheSession.getMap("playersInfo");
    mapTrash = await cacheSession.getMap("trash");
    mapMarineLife = await cacheSession.getMap("marineLife");
    mapPowerUps = await cacheSession.getMap("powerUps");
    mapRooms = await cacheSession.getMap("rooms");
    mapPlayerSockets = {};
  } else {
    mapPlayersTraces = {};
    mapPlayersInfo = {};
    mapTrash = {};
    mapMarineLife = {};
    mapPowerUps = {};
    mapRooms = {};
    mapPlayerSockets = {};
  }

  async function getPlayersInfoObject() {
    return ENABLE_COHERENCE_BACKEND ? localPlayersInfo : mapPlayersInfo;
  }

  async function upsertPlayerSessionProfile(id, input = {}) {
    if (!id) return null;
    const info = await getPlayersInfoObject();
    const existing = info && info[id] ? info[id] : {};
    const profile = buildPlayerSessionProfile(existing, {
      ...input,
      id,
    });
    if (ENABLE_COHERENCE_BACKEND) {
      await writeCache(mapPlayersInfo, id, profile);
    } else {
      mapPlayersInfo[id] = profile;
    }
    runAsyncTask("player.session.profile.persist", () => recordPlayerSessionProfile(profile));
    return profile;
  }

  async function getPlayersInfoForRoom(room) {
    const info = ENABLE_COHERENCE_BACKEND && mapPlayersInfo
      ? await readCacheEntries(mapPlayersInfo)
      : await getPlayersInfoObject();
    const wanted = room || GLOBAL_ROOM;
    const scoped = {};
    for (const [id, value] of Object.entries(info || {})) {
      const profileRoom = value && value.room ? normalizeRoom(value.room) : null;
      const playerRoom = profileRoom || playerRooms.get(id) || GLOBAL_ROOM;
      if (playerRoom === wanted) scoped[id] = value;
    }
    return scoped;
  }

  async function emitLobbyPlayersForRoom(room) {
    if (!room || isLoadCanaryRoom(room)) return;
    const scoped = await getPlayersInfoForRoom(room);
    io.to(room).emit("lobby.players", scoped);
    io.to(room).emit("player.info.all", scoped);
  }

  async function emitLobbyPlayersForRooms(...rooms) {
    const uniqueRooms = Array.from(new Set(rooms.filter(Boolean)));
    await Promise.all(uniqueRooms.map((room) => emitLobbyPlayersForRoom(room)));
  }

  // Persist per-room timer state (document-like record)
  async function persistRoomState(room, state) {
    try {
      if (ENABLE_COHERENCE_BACKEND && mapRooms && room) {
        await writeCache(mapRooms, room, {
          state: state.state,
          startTime: state.startTime || null,
          startingAt: state.startingAt || null,
          updatedAt: Date.now(),
        });
      }
    } catch (e) {
      logger.error(`persistRoomState error: ${e && e.message ? e.message : e}`);
    }
  }

  // Helpers for per-room worlds (items scoped by room)
  function getSocketRoom(sock) {
    try { return (sock && sock.data && sock.data.room) ? sock.data.room : GLOBAL_ROOM; } catch (_) { return GLOBAL_ROOM; }
  }
  function listActiveRooms() {
    const rooms = new Set();
    for (const [, room] of playerRooms.entries()) {
      rooms.add(room || GLOBAL_ROOM);
    }
    return Array.from(rooms.values());
  }
  function shouldSyncVisualItems(room) {
    return !isLoadCanaryRoom(room);
  }
  async function humansInRoom(room) {
    const info = await getPlayersInfoObject();
    const ids = Object.keys(info || {});
    let humans = 0;
    for (const id of ids) {
      const r = playerRooms.get(id) || GLOBAL_ROOM;
      if (r !== (room || GLOBAL_ROOM)) continue;
      if (!isBotProfile(info[id], id)) humans++;
    }
    return Math.max(0, humans);
  }
  // Admin/gameplay helpers. Admin selection remains human-only, but the
  // authoritative simulation must include bots so deployed demo bots can
  // create real collision, powerup, trail, freeze, and game_over telemetry.
  async function listPlayersInRoom(room, { includeBots = true } = {}) {
    const info = await getPlayersInfoObject();
    const ids = Object.keys(info || {});
    const want = room || GLOBAL_ROOM;
    const players = [];
    for (const id of ids) {
      const r = playerRooms.get(id) || GLOBAL_ROOM;
      if (r !== want) continue;
      if (!includeBots && isBotProfile(info[id], id)) continue;
      players.push(id);
    }
    players.sort(); // deterministic next-admin / spawn initialization
    return players;
  }
  async function listHumansInRoom(room) {
    return listPlayersInRoom(room, { includeBots: false });
  }
  async function pickNextAdmin(room) {
    const list = await listHumansInRoom(room);
    return list.length ? list[0] : null;
  }
  async function readAllItemsObjects() {
    const trash = ENABLE_COHERENCE_BACKEND ? await readCacheEntries(mapTrash) : mapTrash;
    const marine = ENABLE_COHERENCE_BACKEND ? await readCacheEntries(mapMarineLife) : mapMarineLife;
    const power = ENABLE_COHERENCE_BACKEND ? await readCacheEntries(mapPowerUps) : mapPowerUps;
    return { trash: trash || {}, marine: marine || {}, power: power || {} };
  }
  async function getItemsForRoom(room) {
    if (!shouldSyncVisualItems(room)) return {};
    const { trash, marine, power } = await readAllItemsObjects();
    const want = room || GLOBAL_ROOM;
    const filtered = {};
    for (const [id, obj] of Object.entries(trash)) {
      const r = obj && obj.room ? obj.room : GLOBAL_ROOM;
      if (r === want) filtered[id] = obj;
    }
    for (const [id, obj] of Object.entries(marine)) {
      const r = obj && obj.room ? obj.room : GLOBAL_ROOM;
      if (r === want) filtered[id] = obj;
    }
    for (const [id, obj] of Object.entries(power)) {
      const r = obj && obj.room ? obj.room : GLOBAL_ROOM;
      if (r === want) filtered[id] = obj;
    }
    return filtered;
  }
  async function countItemsForRoom(room) {
    const all = await getItemsForRoom(room);
    let trash = 0, marine = 0, power = 0;
    for (const obj of Object.values(all)) {
      const t = String(obj.type || "");
      if (t === "trash") trash++;
      else if (t === "turtle") marine++;
      else if (t.startsWith("powerup_")) power++;
    }
    return { trash, marine, powerups: power };
  }

  async function itemPositionsForRoom(room) {
    const all = await getItemsForRoom(room);
    return Object.values(all || {})
      .map((item) => ({
        x: Number(item?.position?.x),
        z: Number(item?.position?.z),
      }))
      .filter((position) => Number.isFinite(position.x) && Number.isFinite(position.z));
  }

  async function chooseStartPositionForRoom(room) {
    const itemPositions = await itemPositionsForRoom(room);
    return chooseSpawnPositionAwayFromPlayers({
      players: itemPositions,
      coordinateFactory: randSpawnCoord,
      worldSizeX,
      worldSizeZ,
      clearRadius: SPAWN_PLAYER_CLEAR_RADIUS,
      attempts: 32,
    });
  }

  async function writeRoomItem(source, id, item) {
    if (!id || !item) return;
    if (source === "trash") {
      if (ENABLE_COHERENCE_BACKEND) await writeCache(mapTrash, id, item);
      else mapTrash[id] = item;
      return;
    }
    if (source === "marine") {
      if (ENABLE_COHERENCE_BACKEND) await writeCache(mapMarineLife, id, item);
      else mapMarineLife[id] = item;
      return;
    }
    if (source === "power") {
      if (ENABLE_COHERENCE_BACKEND) await writeCache(mapPowerUps, id, item);
      else mapPowerUps[id] = item;
    }
  }

  async function clearOpeningItemsNearStart(room, startPosition) {
    if (!shouldSyncVisualItems(room)) return { relocated: 0 };
    const { trash, marine, power } = await readAllItemsObjects();
    const want = room || GLOBAL_ROOM;
    const items = {};
    const sourceById = new Map();
    const addItems = (objects, source) => {
      for (const [id, item] of Object.entries(objects || {})) {
        const itemRoom = item && item.room ? item.room : GLOBAL_ROOM;
        if (itemRoom !== want) continue;
        items[id] = item;
        sourceById.set(id, source);
      }
    };
    addItems(trash, "trash");
    addItems(marine, "marine");
    addItems(power, "power");

    const relocations = buildStartPositionItemRelocations({
      items,
      startPosition,
      coordinateFactory: randSpawnCoord,
      worldSizeX,
      worldSizeZ,
      clearRadius: START_POSITION_ITEM_CLEAR_RADIUS,
      attempts: 64,
    });

    for (const relocation of relocations) {
      const item = items[relocation.id];
      if (!item) continue;
      item.position = {
        x: relocation.position.x,
        y: 0,
        z: relocation.position.z,
      };
      await writeRoomItem(sourceById.get(relocation.id), relocation.id, item);
    }

    if (relocations.length > 0) {
      io.to(room).emit("items.all", await getItemsForRoom(room));
      logger.info({
        room,
        relocated: relocations.length,
        clearRadius: START_POSITION_ITEM_CLEAR_RADIUS,
      }, "opening item safety sweep");
    }
    return { relocated: relocations.length };
  }

  async function seedOpeningTrashNearStart(room, startPosition) {
    if (!shouldSyncVisualItems(room)) return { seeded: 0 };
    const want = room || GLOBAL_ROOM;
    const currentItems = await getItemsForRoom(want);
    const nearbyTrash = Object.values(currentItems || {}).filter((item) => {
      if (!item || item.type !== "trash" || !item.position) return false;
      const dx = Number(item.position.x || 0) - Number(startPosition?.x || 0);
      const dz = Number(item.position.z || 0) - Number(startPosition?.z || 0);
      return Math.hypot(dx, dz) <= OPENING_TRASH_RADIUS + 1.5;
    }).length;
    const needed = Math.max(0, OPENING_TRASH_COUNT - nearbyTrash);
    if (needed <= 0) return { seeded: 0, nearbyTrash };

    const positions = buildOpeningCollectiblePositions({
      startPosition,
      existingItems: currentItems,
      count: needed,
      ringRadius: OPENING_TRASH_RADIUS,
      clearRadius: START_POSITION_ITEM_CLEAR_RADIUS,
      minSpacing: OPENING_TRASH_MIN_SPACING,
      worldSizeX,
      worldSizeZ,
    });

    let seeded = 0;
    for (const position of positions) {
      const obj = itemPool.getObject();
      if (!obj) continue;
      reinitItem(obj, "trash");
      obj.position = { x: position.x, y: 0, z: position.z };
      obj.room = want;
      await writeRoomItem("trash", obj.id, obj);
      io.to(want).emit("item.new", { id: obj.id, data: obj });
      seeded += 1;
    }
    if (seeded > 0) {
      io.to(want).emit("items.all", await getItemsForRoom(want));
      logger.info({
        room: want,
        seeded,
        nearbyTrash,
        radius: OPENING_TRASH_RADIUS,
      }, "opening collectible seed");
    }
    return { seeded, nearbyTrash };
  }

  // Per-room match lifecycle: separate STARTING/RUNNING/ENDED timers per room (time only; items remain global)
function broadcastRoomState(room, state, extra = {}) {
  if (!room) return;
  const rs = roomTimers.get(room) || { state: 'WAITING', startTime: null, startingAt: null, timerId: null };
  rs.state = state;
  if (state === "WAITING" || state === "ENDED") {
    rs.startTime = null;
    rs.startingAt = null;
  }
  if (state === "STARTING" && extra.startsAt) {
    rs.startingAt = extra.startsAt;
  }
  if (state === "RUNNING") {
    rs.startingAt = null;
  }
  roomTimers.set(room, rs);
  persistRoomState(room, rs);
  io.to(room).emit("game.state", state);
  if (!isLoadCanaryRoom(room)) scheduleRoomsUpdate(io);
  if (extra.startsAt) io.to(room).emit("startingGame", extra);
  if (extra.startPosition) io.to(room).emit("game.on", extra);
  if (extra.remaining) io.to(room).emit("game.time", extra.remaining);
  if (extra.end) io.to(room).emit("game.end", extra.end);
}

function clearRoomResetTimer(room) {
  const rs = roomTimers.get(room);
  if (rs && rs.resetTimerId) {
    try { clearTimeout(rs.resetTimerId); } catch (_) {}
    rs.resetTimerId = null;
    roomTimers.set(room, rs);
  }
}

function scheduleRoomWaitingReset(room, delayMs = 10000) {
  if (!room) return;
  clearRoomResetTimer(room);
  const rs = roomTimers.get(room) || { state: 'ENDED', startTime: null, startingAt: null, timerId: null };
  rs.resetTimerId = setTimeout(() => {
    const latest = roomTimers.get(room);
    if (!latest || latest.state !== 'ENDED') return;
    latest.resetTimerId = null;
    roomTimers.set(room, latest);
    broadcastRoomState(room, 'WAITING');
  }, Math.max(0, delayMs));
  roomTimers.set(room, rs);
}

function startRoomMatch(room) {
  if (!room) return { ok: false, error: "missing_room" };
  const existing = roomTimers.get(room) || { state: 'WAITING', startTime: null, startingAt: null, timerId: null };
  if (existing.state !== 'WAITING' && existing.state !== 'ENDED') {
    return { ok: false, error: "invalid_state", room, state: existing.state };
  }
  clearRoomResetTimer(room);
  if (existing.timerId) {
    try { clearInterval(existing.timerId); } catch (_) {}
    existing.timerId = null;
  }

  const startingAt = Date.now() + 10000;
  existing.state = "STARTING";
  existing.startingAt = startingAt;
  existing.startTime = null;
  roomTimers.set(room, existing);
  persistRoomState(room, existing);
  io.to(room).emit("server.info", serverInfoPayload());
  broadcastRoomState(room, 'STARTING', { startsAt: startingAt, countdownMs: 10000 });

  setTimeout(async () => {
    const rs = roomTimers.get(room) || { state: 'WAITING' };
    if (rs.state !== 'STARTING') return; // Prevent race conditions

    const startTime = Date.now();
    const startPosition = await chooseStartPositionForRoom(room).catch(() => ({
      x: randSpawnCoord(worldSizeX),
      y: 0,
      z: randSpawnCoord(worldSizeZ),
    }));
    const startX = startPosition.x;
    const startZ = startPosition.z;
    if (SERVER_AUTH_ENABLED) {
      const players = await listPlayersInRoom(room, { includeBots: true }).catch(() => []);
      for (const playerId of players) {
        playersState.set(playerId, {
          x: startX,
          y: 0,
          z: startZ,
          rotY: 0,
          vel: 0,
          speedMul: 1,
          shield: false,
          effects: { speedUntil: 0, shieldUntil: 0, magnetUntil: 0, freezeUntil: 0 },
          boatType: 'speed',
        });
        playersInput.set(playerId, { throttle: 0, steer: 0, brake: false, lastSeq: -1 });
      }
    }
    await clearOpeningItemsNearStart(room, { x: startX, y: 0, z: startZ })
      .catch((error) => logAsyncFailure("room.start.openingItemSweep", error));
    await seedOpeningTrashNearStart(room, { x: startX, y: 0, z: startZ })
      .catch((error) => logAsyncFailure("room.start.openingTrashSeed", error));
    rs.startTime = startTime;
    rs.startingAt = null;
    broadcastRoomState(room, 'RUNNING', { startPosition: { x: startX, y: 0, z: startZ } });

    if (rs.timerId) clearInterval(rs.timerId);
    rs.timerId = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
      if (remaining <= 0) {
        clearInterval(rs.timerId);
        rs.timerId = null;
        broadcastRoomState(room, 'ENDED', { end: { room } });
        scheduleRoomWaitingReset(room, 10000);
        return;
      }
      io.to(room).emit("game.time", Math.max(0, Math.round(remaining / 1000)));
    }, 1000);
    roomTimers.set(room, rs);
  }, 10000);
  return { ok: true, scope: "room", room, state: "STARTING", startsAt: startingAt, countdownMs: 10000 };
}

function endRoomMatch(room) {
  if (!room) return { ok: false, error: "missing_room" };
  const rs = roomTimers.get(room);
  if (!rs || (rs.state !== "RUNNING" && rs.state !== "STARTING")) {
    return { ok: false, error: "invalid_state", room, state: rs ? rs.state : "WAITING" };
  }
  if (rs.timerId) clearInterval(rs.timerId);
  rs.timerId = null;
  rs.startingAt = null;
  rs.startTime = null;
  broadcastRoomState(room, 'ENDED', { end: { room } });
  scheduleRoomWaitingReset(room, 10000);
  return { ok: true, scope: "room", room, state: "ENDED" };
}

function scheduleRoomRefill(room, delayMs = 0) {
  const key = room || GLOBAL_ROOM;
  if (!shouldSyncVisualItems(key)) return;
  if (pendingRoomRefills.has(key)) return;
  const timer = setTimeout(async () => {
    pendingRoomRefills.delete(key);
    try {
      await refillOnce(key);
    } catch (e) {
      logger.error(`scheduled refill error: ${e && e.message ? e.message : e}`);
    }
  }, Math.max(0, delayMs));
  pendingRoomRefills.set(key, timer);
}

  async function emitPlayerCount() {
    try {
      const info = await getPlayersInfoObject();
      const { total, humans, bots } = countHumansAndBots(info);
      io.emit("player.count", { total, humans, bots });
    } catch (e) {
      logger.error(`emitPlayerCount error: ${e && e.message ? e.message : e}`);
    }
  }

  function summarizeRoomsForObservability(payload) {
    const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
    const summary = { active: rooms.length, waiting: 0, starting: 0, running: 0, ended: 0 };
    for (const room of rooms) {
      const state = String(room?.state || "WAITING").toLowerCase();
      if (state === "starting") summary.starting++;
      else if (state === "running") summary.running++;
      else if (state === "ended") summary.ended++;
      else summary.waiting++;
    }
    return summary;
  }

  io.on("connection", async (socket) => {
    let playerIdForSocket;
    const loadCanarySocket = isLoadCanarySocket(socket);

    socket.emit("server.info", serverInfoPayload());

    socket.data = socket.data || {};
    if (!loadCanarySocket) {
      (async () => {
        try {
          const initialItems = await getItemsForRoom(DEFAULT_ROOM_ID);
          socket.emit("items.all", initialItems);

          socket.emit(
            "player.info.all",
            await getPlayersInfoForRoom(DEFAULT_ROOM_ID)
          );
        } catch (e) {
          logger.error(`initial socket sync error: ${e && e.message ? e.message : e}`);
        }
      })();

      // Default assignment: put every new socket into DEFAULT_ROOM_ID immediately
      const defRoom = DEFAULT_ROOM_ID;
      const prevRoom = socket.data.room || null;
      if (prevRoom && prevRoom !== defRoom) { try { socket.leave(prevRoom); } catch (_) {} }
      socket.data.room = defRoom;
      try { socket.join(defRoom); } catch (_) {}
      scheduleRoomsUpdate(io);
    }


    socket.on("player.info.joining", async ({ id, name, room, clientSessionId, gameplaySessionId, isBot, teacher, botPolicy } = {}) => {
      // Track the playerId bound to this socket for chat attribution/throttling
      if (!id) return;
      playerIdForSocket = id;
      const requestedRoom = normalizeRoom(room);
      const currentRoom = resolveJoiningRoom({
        requestedRoom,
        socketRoom: socket.data && socket.data.room,
        defaultRoom: DEFAULT_ROOM_ID,
      });
      const loadRoom = loadCanarySocket || isLoadCanaryRoom(currentRoom);
      socket.data = socket.data || {};
      const previousRoom = socket.data.room || null;
      if (previousRoom && previousRoom !== currentRoom) {
        try { socket.leave(previousRoom); } catch (_) {}
      }
      socket.data.room = currentRoom;
      try { socket.join(currentRoom); } catch (_) {}
      if (clientSessionId) socket.data.clientSessionId = clientSessionId;
      try { playerRooms.set(id, currentRoom); } catch (_) {}
      const profile = await upsertPlayerSessionProfile(id, {
        name,
        room: currentRoom,
        clientSessionId,
        gameplaySessionId,
        isBot,
        teacher,
        botPolicy,
      });
      socket.emit("player.session", profile);
      // Seed chat history for this socket's current room
      if (!loadRoom) {
        try {
          const r = getSocketRoom(socket);
          const hist = roomChats.get(r) || [];
          socket.emit("chat.history", hist);
          socket.emit("commentary.history", commentaryHistoryForRoom(r));
        } catch (_) {}
        // Broadcast updated lobby roster only to this room.
        await emitLobbyPlayersForRoom(currentRoom);
        await emitPlayerCount();
      }

      // Track player -> room mapping for scoped broadcasts (use socket-assigned default if none provided)
      try {
        const cur = currentRoom;
        playerRooms.set(id, cur);
        // Assign admin if unset for this room and joiner is a human
        try {
          if (cur && !loadRoom && !roomAdmin.has(cur) && !isBotProfile(profile, id)) {
            roomAdmin.set(cur, id);
            io.to(cur).emit("room.admin", { id });
          }
        } catch (_) {}
      } catch (_) {}

      // Join logical room (for per-room timers) and sync its state to this socket
      try {
        if (room && typeof room === "string") {
          socket.data = socket.data || {};
          const rnorm = normalizeRoom(room);
          const prev = socket.data.room || null;
          if (prev && prev !== rnorm) { try { socket.leave(prev); } catch (_) {} }
          socket.data.room = rnorm;
          try { playerRooms.set(id, rnorm); } catch (_) {}
          try { socket.join(rnorm); } catch (_) {}
          try { socket.leave(GLOBAL_ROOM); } catch (_) {}
          if (!isLoadCanaryRoom(rnorm)) scheduleRoomsUpdate(io);
          await emitLobbyPlayersForRooms(prev, rnorm);

          let rs = roomTimers.get(rnorm);
          if (!rs && ENABLE_COHERENCE_BACKEND) {
            try {
              const cached = await readCache(mapRooms, rnorm);
              if (cached && cached.state) {
                rs = { state: cached.state, startTime: cached.startTime || null, startingAt: cached.startingAt || null, timerId: null };
                roomTimers.set(rnorm, rs);
              }
            } catch (_) {}
          }
          if (rs) {
            socket.emit("game.state", rs.state);
            if (rs.state === 'STARTING' && rs.startingAt) {
              socket.emit("startingGame", { startsAt: rs.startingAt, countdownMs: Math.max(0, rs.startingAt - Date.now()) });
            } else if (rs.state === 'RUNNING' && rs.startTime) {
              const startX = randSpawnCoord(worldSizeX);
              const startZ = randSpawnCoord(worldSizeZ);
              socket.emit("game.on", { startPosition: { x: startX, y: 0, z: startZ } });
              const elapsed = Date.now() - rs.startTime;
              const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
              socket.emit("game.time", Math.max(0, Math.round(remaining / 1000)));
            }
          }
          try {
            const itemsForThisRoom = await getItemsForRoom(rnorm);
            socket.emit("items.all", itemsForThisRoom);
          } catch (_) {}
        }
      } catch (e) {
        logger.error(`room join error: ${e && e.message ? e.message : e}`);
      }

      // If no room provided, attach to DEFAULT room and sync its state
      if (!room || typeof room !== "string" || room.trim() === "") {
        const defRoom = DEFAULT_ROOM_ID;
        try {
          socket.data = socket.data || {};
          const prevR = socket.data.room || null;
          if (prevR && prevR !== defRoom) { try { socket.leave(prevR); } catch (_) {} }
          socket.data.room = defRoom;
          try { playerRooms.set(id, defRoom); } catch (_) {}
          socket.join(defRoom);
          await emitLobbyPlayersForRooms(prevR, defRoom);
        } catch (_) {}
        // Sync per-room state if any
        const rs = roomTimers.get(defRoom);
        if (rs) {
          socket.emit("game.state", rs.state);
          if (rs.state === 'STARTING' && rs.startingAt) {
            socket.emit("startingGame", { startsAt: rs.startingAt, countdownMs: Math.max(0, rs.startingAt - Date.now()) });
          } else if (rs.state === 'RUNNING' && rs.startTime) {
            const startX = randSpawnCoord(worldSizeX);
            const startZ = randSpawnCoord(worldSizeZ);
            socket.emit("game.on", { startPosition: { x: startX, y: 0, z: startZ } });
            const elapsed = Date.now() - rs.startTime;
            const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
            socket.emit("game.time", Math.max(0, Math.round(remaining / 1000)));
          }
        } else {
          socket.emit("game.state", 'WAITING');
        }
        try {
          const itemsDefault = await getItemsForRoom(defRoom);
          socket.emit("items.all", itemsDefault);
        } catch (_) {}
        if (!isLoadCanaryRoom(defRoom)) scheduleRoomsUpdate(io);
      }

      // Coalesce join-triggered refills so large rooms do not run a full top-up per player.
      scheduleRoomRefill((socket.data && socket.data.room) || GLOBAL_ROOM);
    });

    // Client requests to join a room explicitly
    socket.on("room.join", async ({ id }) => {
      try {
        const wanted = normalizeRoom(id) || DEFAULT_ROOM_ID;
        const prev = (socket.data && socket.data.room) || null;
        if (prev && prev !== wanted) { try { socket.leave(prev); } catch (_) {} }
        socket.data = socket.data || {};
        socket.data.room = wanted;
        try { socket.join(wanted); } catch (_) {}
        // Track mapping for this player if we know their id already
        if (playerIdForSocket) {
          try { playerRooms.set(playerIdForSocket, wanted); } catch (_) {}
          const profile = await upsertPlayerSessionProfile(playerIdForSocket, {
            room: wanted,
            clientSessionId: socket.data && socket.data.clientSessionId,
          });
          socket.emit("player.session", profile);
          // If no admin yet for this room, promote this player
          try {
            if (!roomAdmin.has(wanted)) {
              roomAdmin.set(wanted, playerIdForSocket);
              io.to(wanted).emit("room.admin", { id: playerIdForSocket });
            }
          } catch (_) {}
        }
        await emitLobbyPlayersForRooms(prev, wanted);
        // Ack to caller and push current state/items for that room
        socket.emit("room.joined", { id: wanted, default: wanted === DEFAULT_ROOM_ID, state: (roomTimers.get(wanted)?.state || 'WAITING') });
        try {
          const rs = roomTimers.get(wanted);
          if (rs) {
            socket.emit("game.state", rs.state);
            if (rs.state === 'STARTING' && rs.startingAt) {
              socket.emit("startingGame", { startsAt: rs.startingAt, countdownMs: Math.max(0, rs.startingAt - Date.now()) });
            } else if (rs.state === 'RUNNING' && rs.startTime) {
              const startX = randSpawnCoord(worldSizeX);
              const startZ = randSpawnCoord(worldSizeZ);
              socket.emit("game.on", { startPosition: { x: startX, y: 0, z: startZ } });
              const elapsed = Date.now() - rs.startTime;
              const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
              socket.emit("game.time", Math.max(0, Math.round(remaining / 1000)));
            }
          } else {
            socket.emit("game.state", 'WAITING');
          }
          const itemsForRoom = await getItemsForRoom(wanted);
          socket.emit("items.all", itemsForRoom);
        } catch (_) {}
        if (!isLoadCanaryRoom(wanted)) scheduleRoomsUpdate(io);
        // Send chat history for this room to the joiner
        try {
          const hist = roomChats.get(wanted) || [];
          socket.emit("chat.history", hist);
          socket.emit("commentary.history", commentaryHistoryForRoom(wanted));
        } catch (_) {}
      } catch (e) {
        logger.error(`room.join error: ${e && e.message ? e.message : e}`);
      }
    });

    socket.on("game.start", async ({ playerId, playerName, clientSessionId, gameplaySessionId, isBot, teacher, botPolicy } = {}) => {
      if (!playerId) return;
      playerIdForSocket = playerId;
      mapPlayerSockets[playerId] = socket;
      const room = getSocketRoom(socket);
      try { playerRooms.set(playerId, room); } catch (_) {}
      if (clientSessionId) {
        socket.data = socket.data || {};
        socket.data.clientSessionId = clientSessionId;
      }
      const profile = await upsertPlayerSessionProfile(playerId, {
        name: playerName,
        room,
        clientSessionId: clientSessionId || (socket.data && socket.data.clientSessionId),
        gameplaySessionId: gameplaySessionId || sessionIdForRoom(room),
        isBot,
        teacher,
        botPolicy,
      });
      socket.emit("player.session", profile);
      io.to(room).emit("player.info.joined", {
        id: playerId,
        name: profile?.name || playerName || "Player",
        profile,
      });
      await emitLobbyPlayersForRoom(room);
      await emitPlayerCount();

      // Initialize authoritative state as soon as the player enters the game flow.
      // Players often press Continue while the room is still waiting/counting down;
      // they still need to appear in authoritative multiplayer snapshots.
      if (SERVER_AUTH_ENABLED && !playersState.has(playerId)) {
        const startX = randSpawnCoord(worldSizeX);
        const startZ = randSpawnCoord(worldSizeZ);
        playersState.set(playerId, {
          x: startX,
          y: 0,
          z: startZ,
          rotY: 0,
          vel: 0,
          speedMul: 1,
          shield: false,
          effects: { speedUntil: 0, shieldUntil: 0, magnetUntil: 0, freezeUntil: 0 },
          boatType: 'speed' // Default type; players can select later
        });
        playersInput.set(playerId, { throttle: 0, steer: 0, brake: false, lastSeq: -1 });
      }
    });

    socket.on("player.boat.select", async ({ playerId, boatType }) => {
      if (SERVER_AUTH_ENABLED && playerId && BOAT_TYPES[boatType]) {
        const st = playersState.get(playerId);
        if (st) {
          st.boatType = boatType;
          playersState.set(playerId, st);
          logger.info(`Player ${playerId} selected boat type: ${boatType}`);
        }
      }
    });

    socket.on("player.trace.change", async (payload = {}) => {
      let id = payload.id;
      let traceData = payload;
      if (payload && payload.c === 1) {
        id = payload.i;
        traceData = {
          x: (Number(payload.x) || 0) / 1000,
          z: (Number(payload.z) || 0) / 1000,
          rotY: (Number(payload.r) || 0) / 10000,
        };
      }
      if (!id) return;
      const body = { ...traceData, updated: new Date() };
      if (ENABLE_COHERENCE_BACKEND) {
        localPlayerTraces[id] = body;
      } else {
        mapPlayersTraces[id] = body;
      }
      const room = playerRooms.get(id) || getSocketRoom(socket);
      io.to(room).volatile.compress(true).emit("player.trace.all", { [id]: body });
    });

    // Server-authoritative input stream (optional; gated by env flag)
    socket.on("player.input", (payload = {}) => {
      try {
        if (!SERVER_AUTH_ENABLED) return;
        let id = payload.id;
        let seq = payload.seq;
        let throttle = payload.throttle ?? 0;
        let steer = payload.steer ?? 0;
        let brake = payload.brake ?? false;
        if (payload && payload.c === 1) {
          id = payload.i;
          seq = payload.q;
          throttle = (Number(payload.t) || 0) / 100;
          steer = (Number(payload.s) || 0) / 100;
          brake = !!payload.b;
        }
        // ingress rate limit: cap to ~60Hz per socket
        if (!socket.data) socket.data = {};
        const now = Date.now();
        const minDelta = Math.floor(1000 / 60);
        if (socket.data.lastInputTs && now - socket.data.lastInputTs < minDelta) return;
        socket.data.lastInputTs = now;
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

    // Client network-quality probe (ack-based RTT measurement)
    socket.on("client.ping", (_payload, ack) => {
      try {
        if (typeof ack === "function") {
          ack({ ok: true, serverTs: Date.now() });
        }
      } catch (_) {}
    });

    socket.on("game.event", async (payload = {}, ack) => {
      try {
        const room = getSocketRoom(socket);
        let canonicalPlayerName;
        try {
          const info = await getPlayersInfoObject();
          canonicalPlayerName = playerIdForSocket && info && info[playerIdForSocket] && info[playerIdForSocket].name
            ? String(info[playerIdForSocket].name)
            : undefined;
        } catch (_) {}
        const result = await recordGameEvent(payload, {
          roomId: room,
          sessionId: payload.session_id || payload.sessionId || sessionIdForRoom(room),
          playerId: playerIdForSocket,
          playerName: canonicalPlayerName,
        });
        let commentary = null;
        if (result.event && result.event.event_type === "game_over") {
          commentary = queueGameOverCommentary(io, {
            room,
            event: result.event,
            playerName: canonicalPlayerName,
          });
        }
        const response = { ...result, commentary };
        try { if (typeof ack === "function") ack(response); } catch (_) {}
      } catch (error) {
        const response = { ok: false, error: error && error.message ? error.message : String(error) };
        try { if (typeof ack === "function") ack(response); } catch (_) {}
      }
    });

    socket.on("items.collision", async ({ itemId, playerId, playerName, clientPosition, clientItemPosition } = {}, ack) => {
      const safeAck = (payload) => {
        try { if (typeof ack === "function") ack(payload); } catch (_) {}
      };
      try {
        const room = getSocketRoom(socket);
        if (playerIdForSocket) {
          if (playerId && playerId !== playerIdForSocket) {
            safeAck({ ok: false, error: "wrong_player", itemId });
            return;
          }
          playerId = playerIdForSocket;
        }
        if (!playerId) {
          safeAck({ ok: false, error: "missing_player", itemId });
          return;
        }
        try {
          const info = await getPlayersInfoObject();
          const recordedName = info && info[playerId] && info[playerId].name ? String(info[playerId].name) : "";
          playerName = recordedName || playerName || "Player";
        } catch (_) {
          playerName = playerName || "Player";
        }
        // Ignore collisions unless match is RUNNING (per-room or global)
        const rs = roomTimers.get(room);
        if (rs ? rs.state !== 'RUNNING' : gameState !== 'RUNNING') {
          safeAck({ ok: false, error: "not_running", itemId });
          return;
        }
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

        if (!item) {
          safeAck({ ok: false, error: "item_not_found", itemId });
          return;
        }
        // Ignore collisions against items not in this socket's room
        if (item && item.room && item.room !== room) {
          safeAck({ ok: false, error: "wrong_room", itemId, room });
          return;
        }
        const itemSnapshot = snapshotItemForEvent(item);

        // Validate proximity against the same position stream the browser renders.
        // In production the old server-authoritative state can lag the restored
        // client-owned boat controls, so prefer fresh player traces for pickups.
        {
          const validationPosition = collisionClientPosition(clientPosition) || collisionValidationPosition(playerId);
          if (!validationPosition) {
            safeAck({ ok: false, error: "missing_player_position", itemId });
            return;
          }
          const ipos = collisionClientPosition(clientItemPosition) || item.position || { x: 0, z: 0 };
          const dx = (validationPosition.x || 0) - ipos.x;
          const dz = (validationPosition.z || 0) - ipos.z;
          const dist = Math.hypot(dx, dz);
          const footprintRadius = collisionBoatRadius(playerId) + collisionItemRadius(itemType, item);
          let allowedRadius = footprintRadius + PICKUP_TOUCH_FORGIVENESS;
          const st = playersState.get(playerId);
          if (st?.effects && st.effects.magnetUntil && Date.now() < st.effects.magnetUntil) {
            allowedRadius = Math.max(allowedRadius, POWERUP_MAGNET_RADIUS);
          }
          if (dist > allowedRadius) {
            // Ignore spoofed/late collisions
            safeAck({
              ok: false,
              error: "too_far",
              itemId,
              distance: Number(dist.toFixed(3)),
              allowedRadius,
              positionSource: validationPosition.source,
            });
            return;
          }
        }

        const acceptedPayload = (scoreDelta = 0) => ({
          ok: true,
          id: itemId,
          itemId,
          itemType: itemSnapshot?.type || itemType,
          playerId,
          playerName,
          position: itemSnapshot?.position || null,
          scoreDelta,
          powerupType: String(itemSnapshot?.type || "").startsWith("powerup_") ? itemSnapshot.type : null,
        });

        // Remove the item, update score/effects accordingly
        if (itemType === "trash") {
          if (ENABLE_COHERENCE_BACKEND) {
            await deleteCache(mapTrash, itemId);
          } else {
            delete mapTrash[itemId];
          }
          const accepted = acceptedPayload(1);
          io.to(room).emit("item.destroy", accepted);
          if (item) itemPool.returnObject(item);
          await postCurrentScore(playerId, playerName, "INCREMENT");
          await recordGameEvent({
            type: "trash_collected",
            playerId,
            playerName,
            itemId,
            score: null,
            position: itemSnapshot?.position,
            metadata: { item_type: itemSnapshot?.type || "trash" },
          }, { roomId: room, sessionId: sessionIdForRoom(room) });
          safeAck(accepted);
          await refillOnce(room);
        } else if (itemType === "turtle") {
          if (ENABLE_COHERENCE_BACKEND) {
            await deleteCache(mapMarineLife, itemId);
          } else {
            delete mapMarineLife[itemId];
          }
          const shielded = !!(SERVER_AUTH_ENABLED && playersState.get(playerId)?.shield);
          const accepted = acceptedPayload(shielded ? 0 : -1);
          io.to(room).emit("item.destroy", accepted);
          if (item) itemPool.returnObject(item);
          // If shielded under authority, do not decrement
          if (!shielded) {
            await postCurrentScore(playerId, playerName, "DECREMENT");
            await recordGameEvent({
              type: "marine_hit",
              playerId,
              playerName,
              itemId,
              score: null,
              position: itemSnapshot?.position,
              metadata: { item_type: itemSnapshot?.type || "turtle" },
            }, { roomId: room, sessionId: sessionIdForRoom(room) });
          }
          safeAck(accepted);
          await refillOnce(room);
        } else {
          // Power-ups
          if (ENABLE_COHERENCE_BACKEND) {
            await deleteCache(mapPowerUps, itemId);
          } else {
            delete mapPowerUps[itemId];
          }
          const accepted = acceptedPayload(0);
          io.to(room).emit("item.destroy", accepted);
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
              effects: { speedUntil: 0, shieldUntil: 0, magnetUntil: 0, freezeUntil: 0 }
            };
            // Distinguish type by stored item.type if present
            const typeName = (itemSnapshot?.type && String(itemSnapshot.type)) || "";
            if (typeName === "powerup_speed") {
              st.speedMul = POWERUP_SPEED_MULTIPLIER;
              st.effects = st.effects || {};
              st.effects.speedUntil = Date.now() + POWERUP_SPEED_DURATION_MS;
            } else if (typeName === "powerup_shield") {
              st.shield = true;
              st.effects = st.effects || {};
              st.effects.shieldUntil = Date.now() + POWERUP_SHIELD_DURATION_MS;
            } else if (typeName === "powerup_magnet") {
              st.effects = st.effects || {};
              st.effects.magnetUntil = Date.now() + POWERUP_MAGNET_DURATION_MS;
            } else if (typeName === "powerup_freeze") {
              st.effects = st.effects || {};
              st.effects.freezeUntil = Date.now() + POWERUP_FREEZE_DURATION_MS;
            }
            playersState.set(playerId, st);
          }
          await recordGameEvent({
            type: "powerup_collected",
            playerId,
            playerName,
            itemId,
            position: itemSnapshot?.position,
            powerupType: itemSnapshot?.type,
            metadata: { item_type: itemSnapshot?.type },
          }, { roomId: room, sessionId: sessionIdForRoom(room) });
          safeAck(accepted);
        }
      } catch (e) {
        logger.error(`items.collision error: ${e && e.message ? e.message : e}`);
        safeAck({ ok: false, error: e && e.message ? e.message : String(e), itemId });
      }
    });
    
    // Lobby chat: receive text, validate/throttle, store, and broadcast
    socket.on("chat.send", async ({ text }) => {
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
        let name = "Player";
        try {
          const info = await getPlayersInfoObject();
          if (info && id && info[id] && info[id].name) name = String(info[id].name);
        } catch (_) {}

        const msg = { id, name, text: trimmed, ts: now };
        const room = getSocketRoom(socket);
        const list = roomChats.get(room) || [];
        list.push(msg);
        if (list.length > CHAT_HISTORY_LIMIT) list.shift();
        roomChats.set(room, list);
        io.to(room).emit("chat.message", msg);
      } catch (e) {
        logger.error(`chat.send error: ${e && e.message ? e.message : e}`);
      }
    });

    socket.on("disconnect", async (reason) => {
      const prevRoom = playerRooms.get(playerIdForSocket) || null;
      const loadRoom = loadCanarySocket || isLoadCanaryRoom(prevRoom);
      if (!loadRoom) io.to(prevRoom || GLOBAL_ROOM).emit("player.info.left", playerIdForSocket);
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
      playerRooms.delete(playerIdForSocket);
      // Reassign admin if necessary
      try {
        if (!loadRoom && prevRoom && roomAdmin.get(prevRoom) === playerIdForSocket) {
          const next = await pickNextAdmin(prevRoom);
          if (next) {
            roomAdmin.set(prevRoom, next);
            io.to(prevRoom).emit("room.admin", { id: next });
          } else {
            roomAdmin.delete(prevRoom);
          }
        }
      } catch (_) {}
      // Update rooms directory after membership change
      if (!loadRoom) scheduleRoomsUpdate(io);

      // Broadcast updated lobby roster after removal
      if (!loadRoom) {
        await emitLobbyPlayersForRoom(prevRoom || GLOBAL_ROOM);
      }
      logger.info(`${playerIdForSocket} disconnected because ${reason}`);
      if (!loadRoom) await emitPlayerCount();
      playerIdForSocket = undefined;
    });

    socket.on("admin.presenter.start", (payload = {}, ack) => {
      const cmdId = payload && payload.cmdId;
      if (adminTrackDuplicate(cmdId)) { try { if (typeof ack === "function") ack({ ok: true, duplicate: true }); } catch (_) {} return; }
      try {
        if (!isPresenterCommandAuthorized(payload)) {
          try { if (typeof ack === "function") ack({ ok: false, error: "unauthorized" }); } catch (_) {}
          return;
        }
        const room = normalizeRoom(payload.room || payload.id || payload.roomId) || DEFAULT_ROOM_ID;
        const result = startRoomMatch(room);
        try { if (typeof ack === "function") ack(result); } catch (_) {}
      } catch (e) {
        logger.error(`admin.presenter.start error: ${e && e.message ? e.message : e}`);
        try { if (typeof ack === "function") ack({ ok: false, error: "server_error" }); } catch (_) {}
      }
    });

    socket.on("admin.presenter.end", (payload = {}, ack) => {
      const cmdId = payload && payload.cmdId;
      if (adminTrackDuplicate(cmdId)) { try { if (typeof ack === "function") ack({ ok: true, duplicate: true }); } catch (_) {} return; }
      try {
        if (!isPresenterCommandAuthorized(payload)) {
          try { if (typeof ack === "function") ack({ ok: false, error: "unauthorized" }); } catch (_) {}
          return;
        }
        const room = normalizeRoom(payload.room || payload.id || payload.roomId) || DEFAULT_ROOM_ID;
        const result = endRoomMatch(room);
        try { if (typeof ack === "function") ack(result); } catch (_) {}
      } catch (e) {
        logger.error(`admin.presenter.end error: ${e && e.message ? e.message : e}`);
        try { if (typeof ack === "function") ack({ ok: false, error: "server_error" }); } catch (_) {}
      }
    });

    socket.on("admin.presenter.grant", async (payload = {}, ack) => {
      const cmdId = payload && payload.cmdId;
      if (adminTrackDuplicate(cmdId)) { try { if (typeof ack === "function") ack({ ok: true, duplicate: true }); } catch (_) {} return; }
      try {
        if (!isPresenterCommandAuthorized(payload)) {
          try { if (typeof ack === "function") ack({ ok: false, error: "unauthorized" }); } catch (_) {}
          return;
        }
        const room = normalizeRoom(payload.room || payload.roomId || payload.idRoom) || DEFAULT_ROOM_ID;
        const target = String(payload.id || payload.playerId || "").trim();
        if (!target) {
          try { if (typeof ack === "function") ack({ ok: false, error: "invalid_target" }); } catch (_) {}
          return;
        }
        if (playerRooms.get(target) !== room) {
          try { if (typeof ack === "function") ack({ ok: false, error: "wrong_room", room, id: target }); } catch (_) {}
          return;
        }
        const info = await getPlayersInfoObject();
        if (isBotProfile(info && info[target], target)) {
          try { if (typeof ack === "function") ack({ ok: false, error: "target_is_bot" }); } catch (_) {}
          return;
        }
        roomAdmin.set(room, target);
        io.to(room).emit("room.admin", { id: target });
        try { if (typeof ack === "function") ack({ ok: true, room, id: target }); } catch (_) {}
      } catch (e) {
        logger.error(`admin.presenter.grant error: ${e && e.message ? e.message : e}`);
        try { if (typeof ack === "function") ack({ ok: false, error: "server_error" }); } catch (_) {}
      }
    });

    socket.on("admin.start", (payload = {}, ack) => {
      const cmdId = payload && payload.cmdId;
      if (adminTrackDuplicate(cmdId)) { try { if (typeof ack === "function") ack({ ok: true, duplicate: true }); } catch (_) {} return; }
      // If this client is in a room, start that room's independent timer/countdown
      const room = (socket.data && socket.data.room) || null;
      if (room) {
        // If no admin yet, first caller claims admin automatically for smoother UX
        if (!roomAdmin.has(room)) {
          roomAdmin.set(room, playerIdForSocket);
          io.to(room).emit("room.admin", { id: playerIdForSocket });
        }
        // Authorization: only current room admin may start
        if (roomAdmin.get(room) !== playerIdForSocket) { try { if (typeof ack === "function") ack({ ok: false, error: "not_admin" }); } catch (_) {} return; }
        const result = startRoomMatch(room);
        try { if (typeof ack === "function") ack(result); } catch (_) {}
        return;
      }
      if (gameState !== 'WAITING') { try { if (typeof ack === "function") ack({ ok: false, error: "invalid_state" }); } catch (_) {} return; }
      gameState = 'STARTING';
      difficultyLevel = 0;
      lastDifficultyAt = Date.now();
      io.to(GLOBAL_ROOM).emit("game.state", gameState);
      // Broadcast fresh server info and synchronized countdown
      gameStartingAt = Date.now() + 10000;
      try { if (typeof ack === "function") ack({ ok: true, scope: "global" }); } catch (_) {}
      io.to(GLOBAL_ROOM).emit("server.info", {
        ...serverInfoPayload(),
      });
      io.to(GLOBAL_ROOM).emit("startingGame", { startsAt: gameStartingAt, countdownMs: 10000 });
      setTimeout(() => {
        gameState = 'RUNNING';
        io.to(GLOBAL_ROOM).emit("game.state", gameState);
        gameStartingAt = null;
        Object.keys(mapPlayerSockets).forEach((playerId) => {
          const socket = mapPlayerSockets[playerId];
          const startX = randSpawnCoord(worldSizeX);
          const startZ = randSpawnCoord(worldSizeZ);
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
              effects: { speedUntil: 0, shieldUntil: 0, magnetUntil: 0, freezeUntil: 0 }
            });
            playersInput.set(playerId, { throttle: 0, steer: 0, brake: false, lastSeq: -1 });
          }
        });
        gameStartTime = Date.now();

        // Seed initial items and power-ups immediately for visibility
        runAsyncTask("admin.start.initialItems", async () => {
          const numPlayersNow = await mapEntryCount(mapPlayersInfo);

          // Trash
          for (let i = 0; i < Math.max(1, numPlayersNow); i++) {
            const obj = itemPool.getObject();
            if (obj) {
              reinitItemForRoom(obj, 'trash', GLOBAL_ROOM);
              obj.room = GLOBAL_ROOM;
              io.to(GLOBAL_ROOM).emit('item.new', { id: obj.id, data: obj });
              ENABLE_COHERENCE_BACKEND ? await writeCache(mapTrash, obj.id, obj) : (mapTrash[obj.id] = obj);
            }
          }

          // Marine life
          for (let i = 0; i < Math.max(2, numPlayersNow * 2); i++) {
            const obj = itemPool.getObject();
            if (obj) {
              reinitItemForRoom(obj, 'turtle', GLOBAL_ROOM);
              obj.room = GLOBAL_ROOM;
              io.to(GLOBAL_ROOM).emit('item.new', { id: obj.id, data: obj });
              ENABLE_COHERENCE_BACKEND ? await writeCache(mapMarineLife, obj.id, obj) : (mapMarineLife[obj.id] = obj);
            }
          }

          // Power-ups
          const puCount = Math.min(2, numPlayersNow);
          const powerTypes = ["powerup_speed", "powerup_shield", "powerup_magnet", "powerup_freeze"];
          for (let i = 0; i < puCount; i++) {
            const obj = itemPool.getObject();
            if (obj) {
              const ptype = powerTypes[i % powerTypes.length];
              reinitItemForRoom(obj, ptype, GLOBAL_ROOM);
              obj.room = GLOBAL_ROOM;
              io.to(GLOBAL_ROOM).emit('item.new', { id: obj.id, data: obj });
              ENABLE_COHERENCE_BACKEND ? await writeCache(mapPowerUps, obj.id, obj) : (mapPowerUps[obj.id] = obj);
            }
          }
        });

        gameTimer = setInterval(() => {
          const elapsed = Date.now() - gameStartTime;
          const remaining = GAME_DURATION_IN_SECONDS * 1000 - elapsed;
          io.to(GLOBAL_ROOM).emit("game.time", Math.max(0, Math.round(remaining / 1000)));
          if (remaining <= 0) {
            clearInterval(gameTimer);
            gameState = 'ENDED';
            io.to(GLOBAL_ROOM).emit("game.state", gameState);
            io.to(GLOBAL_ROOM).emit("game.end");
            Object.keys(mapPlayerSockets).forEach(async (playerId) => {
              const socket = mapPlayerSockets[playerId];
              socket.emit("game.end", { playerId });
              io.to(playerRooms.get(playerId) || GLOBAL_ROOM).emit("player.info.left", playerId);
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
              io.to(GLOBAL_ROOM).emit("game.state", gameState);
              emitPlayerCount();
            }, 10000);
          }
        }, 1000);
      }, 10000);
    });

    socket.on("admin.end", (payload = {}, ack) => {
      const cmdId = payload && payload.cmdId;
      if (adminTrackDuplicate(cmdId)) { try { if (typeof ack === "function") ack({ ok: true, duplicate: true }); } catch (_) {} return; }
      // If this client is in a room, end that room's independent timer
      const room = (socket.data && socket.data.room) || null;
      if (room) {
        // Authorization: only current room admin may end
        if (roomAdmin.get(room) !== playerIdForSocket) { try { if (typeof ack === "function") ack({ ok: false, error: "not_admin" }); } catch (_) {} return; }
        const result = endRoomMatch(room);
        try { if (typeof ack === "function") ack(result); } catch (_) {}
        return;
      }
      if (gameState !== 'RUNNING' && gameState !== 'STARTING') { try { if (typeof ack === "function") ack({ ok: false, error: "invalid_state" }); } catch (_) {} return; }
      if (gameTimer) clearInterval(gameTimer);
      gameState = 'ENDED';
      difficultyLevel = 0;
      lastDifficultyAt = Date.now();
      io.to(GLOBAL_ROOM).emit("game.state", gameState);
      io.to(GLOBAL_ROOM).emit("game.end");
      try { if (typeof ack === "function") ack({ ok: true, scope: "global" }); } catch (_) {}
      Object.keys(mapPlayerSockets).forEach(async (playerId) => {
        const socket = mapPlayerSockets[playerId];
        socket.emit("game.end", { playerId });
        io.to(playerRooms.get(playerId) || GLOBAL_ROOM).emit("player.info.left", playerId);
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
        io.to(GLOBAL_ROOM).emit("game.state", gameState);
        emitPlayerCount();
      }, 10000);
    });

    // Admin: claim admin for current room if none assigned
    socket.on("admin.claim", () => {
      try {
        const room = getSocketRoom(socket);
        if (!room) return;
        if (!roomAdmin.has(room)) {
          roomAdmin.set(room, playerIdForSocket);
          io.to(room).emit("room.admin", { id: playerIdForSocket });
        }
      } catch (e) {
        logger.error(`admin.claim error: ${e && e.message ? e.message : e}`);
      }
    });

    // Admin: reassign admin within the same room
    socket.on("admin.grant", async ({ id, cmdId } = {}, ack) => {
      if (adminTrackDuplicate(cmdId)) { try { if (typeof ack === "function") ack({ ok: true, duplicate: true }); } catch (_) {} return; }
      try {
        const room = getSocketRoom(socket);
        if (!room) { try { if (typeof ack === "function") ack({ ok: false, error: "not_in_room" }); } catch (_) {} return; }
        // Only current admin can grant
        if (roomAdmin.get(room) !== playerIdForSocket) { try { if (typeof ack === "function") ack({ ok: false, error: "not_admin" }); } catch (_) {} return; }
        const target = String(id || "").trim();
        if (!target) { try { if (typeof ack === "function") ack({ ok: false, error: "invalid_target" }); } catch (_) {} return; }
        // Must be in the same room
        if (playerRooms.get(target) !== room) { try { if (typeof ack === "function") ack({ ok: false, error: "wrong_room" }); } catch (_) {} return; }
        // Ensure target is a human
        const info = await getPlayersInfoObject();
        if (isBotProfile(info && info[target], target)) { try { if (typeof ack === "function") ack({ ok: false, error: "target_is_bot" }); } catch (_) {} return; }
        roomAdmin.set(room, target);
        io.to(room).emit("room.admin", { id: target });
        try { if (typeof ack === "function") ack({ ok: true, room, id: target }); } catch (_) {}
      } catch (e) {
        logger.error(`admin.grant error: ${e && e.message ? e.message : e}`);
      }
    });

    // Admin: switch spawn mode/params
    socket.on("admin.spawnMode.set", ({ mode, params }) => {
      try {
        if (mode === "fibonacci" || mode === "proportional") spawnMode = mode;
        if (params && typeof params === "object") {
          spawnParams = { ...spawnParams, ...params };
        }
      } catch (e) {
        logger.error(`admin.spawnMode.set error: ${e && e.message ? e.message : e}`);
      }
    });

    // Admin: adjust world scaling bounds/base
    socket.on("admin.worldScaling.set", ({ minX, minZ, maxX, maxZ, baseX, baseZ, basePlayers }) => {
      try {
        if (Number.isFinite(minX)) worldScaleCfg.minX = parseInt(minX);
        if (Number.isFinite(minZ)) worldScaleCfg.minZ = parseInt(minZ);
        if (Number.isFinite(maxX)) worldScaleCfg.maxX = parseInt(maxX);
        if (Number.isFinite(maxZ)) worldScaleCfg.maxZ = parseInt(maxZ);
        if (Number.isFinite(baseX)) worldScaleCfg.baseX = parseInt(baseX);
        if (Number.isFinite(baseZ)) worldScaleCfg.baseZ = parseInt(baseZ);
        if (Number.isFinite(basePlayers)) worldScaleCfg.basePlayers = parseInt(basePlayers);
        runAsyncTask("admin.worldScaling.set", async () => {
          const info = await getPlayersInfoObject();
          const { humans } = countHumansAndBots(info);
          const desired = recomputeWorldSize(humans);
          worldSizeX = desired.x;
          worldSizeZ = desired.z;
          io.emit("server.info", {
            ...serverInfoPayload(),
          });
        });
      } catch (e) {
        logger.error(`admin.worldScaling.set error: ${e && e.message ? e.message : e}`);
      }
    });
  });

  io.engine.on("connection_error", async (err) => {
    logger.error(`ERROR ${err.code}: ${err.message}; ${err.context}`);
  });

  // Difficulty progression timer (every 10s => +2 extra targets step by default)
  setInterval(() => {
    if (gameState === 'RUNNING') {
      const now = Date.now();
      if (now - lastDifficultyAt >= DIFFICULTY_INTERVAL_MS) {
        difficultyLevel += 1;
        lastDifficultyAt = now;
      }
    } else {
      // Reset difficulty outside of active gameplay
      difficultyLevel = 0;
      lastDifficultyAt = Date.now();
    }
  }, 1000);

  // Server-authoritative simulation and state broadcast (optional)
  if (SERVER_AUTH_ENABLED) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const step = (dt) => {
    const now = Date.now();
    const WORLD_HALF_X = worldSizeX / 2;
    const WORLD_HALF_Z = worldSizeZ / 2;
    const freezeByRoom = new Map();
    for (const [pid, st] of playersState.entries()) {
      const until = st && st.effects ? Number(st.effects.freezeUntil || 0) : 0;
      if (until > now) {
        const room = playerRooms.get(pid) || GLOBAL_ROOM;
        const prev = freezeByRoom.get(room) || 0;
        if (until > prev) freezeByRoom.set(room, until);
      }
    }
    for (const [id, state] of playersState.entries()) {
      const input = playersInput.get(id) || { throttle: 0, steer: 0, brake: false };
      const boatType = state.boatType || 'speed';
      const typeConfig = BOAT_TYPES[boatType] || BOAT_TYPES.speed;

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
        if (state.effects.magnetUntil && now > state.effects.magnetUntil) {
          state.effects.magnetUntil = 0;
        }
        if (state.effects.freezeUntil && now > state.effects.freezeUntil) {
          state.effects.freezeUntil = 0;
        }
      }

      // Type-specific physics
      const room = playerRooms.get(id) || GLOBAL_ROOM;
      const frozenByOther = freezeByRoom.get(room) > now && !(state.effects && state.effects.freezeUntil && state.effects.freezeUntil > now);
      const freezeMul = frozenByOther ? POWERUP_FREEZE_OTHER_MULT : 1;
      const acc = typeConfig.acceleration * (state.speedMul || 1) * freezeMul;
      const brakeAcc = typeConfig.brake;
      const friction = typeConfig.drag;
      const turnSpeed = typeConfig.turnSpeed * typeConfig.handling;
      const configuredMaxSpeed = Math.max(0, Number(typeConfig.maxSpeed) || PHYSICS_CONFIG.maxSpeed || 3);
      const hardSpeedLimit = Math.max(0.5, Number(SERVER_AUTH_MAX_SPEED_LIMIT) || 4.5);
      const maxSpeed = Math.min(hardSpeedLimit, configuredMaxSpeed * (state.speedMul || 1) * freezeMul);

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
      const t = Date.now();
      // Build per-room snapshots
      const byRoom = new Map();
      for (const [id, s] of playersState.entries()) {
        const room = playerRooms.get(id) || GLOBAL_ROOM;
        if (!byRoom.has(room)) byRoom.set(room, {});
        byRoom.get(room)[id] = { x: s.x || 0, z: s.z || 0, rotY: s.rotY || 0, speed: s.vel || 0 };
      }
      for (const [room, states] of byRoom.entries()) {
        io.to(room).volatile.compress(true).emit("player.state", { t, states });
      }
    }, Math.max(1, Math.round(1000 / Math.max(1, STATE_BROADCAST_HZ))));
  }

  // broadcast all players traces (scoped per room)
  setAsyncInterval("player.trace.broadcast", async () => {
    const tracesAll = ENABLE_COHERENCE_BACKEND
      ? localPlayerTraces
      : mapPlayersTraces;
    const byRoom = new Map();
    for (const [id, trace] of Object.entries(tracesAll || {})) {
      const room = playerRooms.get(id) || GLOBAL_ROOM;
      if (!byRoom.has(room)) byRoom.set(room, {});
      byRoom.get(room)[id] = trace;
    }
    for (const [room, traces] of byRoom.entries()) {
      io.to(room).volatile.compress(true).emit("player.trace.all", traces);
    }
  }, BROADCAST_REFRESH_UPDATE);

  // Fast refill helper used on interval and after item removals
  async function refillOnce(roomParam) {
    if (roomParam && !shouldSyncVisualItems(roomParam)) return;
    // Keep world scaling based on global humans (shared water surface), but items are per-room.
    const info = await getPlayersInfoObject();
    const { humans: humansGlobal } = countHumansAndBots(info);

    // Dynamic world scaling (global)
    const desired = recomputeWorldSize(humansGlobal);
    if (desired.x !== worldSizeX || desired.z !== worldSizeZ) {
      worldSizeX = desired.x;
      worldSizeZ = desired.z;
      io.emit("server.info", {
        ...serverInfoPayload(),
      });
    }

    const rooms = (roomParam ? [roomParam] : listActiveRooms()).filter(shouldSyncVisualItems);
    for (const room of rooms) {
      const humans = await humansInRoom(room);
      const targets = computeEffectiveTargets(humans);
      const counts = await countItemsForRoom(room);

      const addTrashTotal = Math.max(0, targets.trash - counts.trash);
      const addMarineTotal = Math.max(0, targets.marine - counts.marine);

      const ticksPerSecond = Math.max(0.1, 1000 / ITEMS_REFRESH_MS);
      const horizonTicks = Math.max(1, Math.round(SPAWN_REFILL_HORIZON_SEC * ticksPerSecond));
      const majorTrash = addTrashTotal >= 10 || (targets.trash > 0 && addTrashTotal / targets.trash >= 0.5);
      const majorMarine = addMarineTotal >= 10 || (targets.marine > 0 && addMarineTotal / targets.marine >= 0.5);

      const spawnTrash = majorTrash
        ? Math.min(addTrashTotal, SPAWN_MAX_PER_TICK_TRASH)
        : Math.min(addTrashTotal, SPAWN_MAX_PER_TICK_TRASH, Math.max(1, Math.ceil(addTrashTotal / horizonTicks)));
      const spawnMarine = majorMarine
        ? Math.min(addMarineTotal, SPAWN_MAX_PER_TICK_MARINE)
        : Math.min(addMarineTotal, SPAWN_MAX_PER_TICK_MARINE, Math.max(1, Math.ceil(addMarineTotal / horizonTicks)));

      for (let i = 0; i < spawnTrash; i++) {
        const obj = itemPool.getObject();
        if (obj) {
          reinitItemForRoom(obj, 'trash', room);
          obj.room = room;
          io.to(room).emit('item.new', { id: obj.id, data: obj });
          ENABLE_COHERENCE_BACKEND ? await writeCache(mapTrash, obj.id, obj) : (mapTrash[obj.id] = obj);
        }
      }
      for (let i = 0; i < spawnMarine; i++) {
        const obj = itemPool.getObject();
        if (obj) {
          reinitItemForRoom(obj, 'turtle', room);
          obj.room = room;
          io.to(room).emit('item.new', { id: obj.id, data: obj });
          ENABLE_COHERENCE_BACKEND ? await writeCache(mapMarineLife, obj.id, obj) : (mapMarineLife[obj.id] = obj);
        }
      }
    }
  }

  // refresh items (per-room targets)
  setAsyncInterval("item.refill", async () => {
    await refillOnce();
    nextItemsSpawnAt = Date.now() + ITEMS_REFRESH_MS;
  }, ITEMS_REFRESH_MS);


  // Spawn power-ups to per-room targets (refill smoothly)
  setAsyncInterval("powerup.refill", async () => {
    const rooms = listActiveRooms().filter(shouldSyncVisualItems);
    for (const room of rooms) {
      const humans = await humansInRoom(room);
      const targets = computeTargets(humans);

      // Count existing power-ups in this room
      const counts = await countItemsForRoom(room);
      const totalDeficit = Math.max(0, targets.powerups - counts.powerups);

      const ticksPerSecondPU = Math.max(0.1, 1000 / POWERUP_REFRESH_MS);
      const horizonTicksPU = Math.max(1, Math.round(SPAWN_REFILL_HORIZON_SEC * ticksPerSecondPU));
      const spawnPU = Math.min(totalDeficit, Math.max(1, Math.ceil(totalDeficit / horizonTicksPU)), 4);

      const powerTypes = ["powerup_speed", "powerup_shield", "powerup_magnet", "powerup_freeze"];
      for (let i = 0; i < spawnPU; i++) {
        const obj = itemPool.getObject();
        if (obj) {
          const ptype = powerTypes[i % powerTypes.length];
          reinitItemForRoom(obj, ptype, room);
          obj.room = room;
          io.to(room).emit("item.new", { id: obj.id, data: obj });
          if (ENABLE_COHERENCE_BACKEND) {
            await writeCache(mapPowerUps, obj.id, obj);
          } else {
            mapPowerUps[obj.id] = obj;
          }
        }
      }
    }
  }, POWERUP_REFRESH_MS);

  // Clean stale players, and send delete player if stale
  setAsyncInterval("stale-player.cleanup", async () => {
    const now = new Date();
    // TODO: Optimize stale detection; investigate Coherence TTL for automatic expiration
    // Currently adding elapsed to check; consider if cleanup is necessary or can be handled by disconnect events
    const traces = ENABLE_COHERENCE_BACKEND
      ? localPlayerTraces
      : mapPlayersTraces;
    const elapsedTimesById = Object.entries(traces).map((player) => ({
      id: player[0],
      elapsed: now - player[1].updated,
    }));
    const staleIds = elapsedTimesById.filter((e) => e.elapsed > 250);
    for (const p of staleIds) {
      logger.info(`Stale player ${p.id} by ${p.elapsed}ms`);
      const room = playerRooms.get(p.id) || GLOBAL_ROOM;
      const roomState = roomTimers.get(room)?.state || gameState || "WAITING";
      if (roomState !== "RUNNING") {
        if (ENABLE_COHERENCE_BACKEND) {
          await deleteCache(mapPlayersTraces, p.id);
        } else {
          delete mapPlayersTraces[p.id];
        }
        continue;
      }
      if (ENABLE_COHERENCE_BACKEND) {
        await deleteCache(mapPlayersTraces, p.id);
        await deleteCache(mapPlayersInfo, p.id);
      } else {
        delete mapPlayersTraces[p.id];
        delete mapPlayersInfo[p.id];
      }

      io.to(room).emit('player.info.left', p.id);
    }
    emitPlayerCount();
  }, CLEANUP_STALE_IN_SECONDS * 1000);

  setAsyncInterval("item.count.log", async () => {
    const numPlayers = await mapEntryCount(mapPlayersInfo);
    const numTrash = await mapEntryCount(mapTrash);
    const numMarineLife = await mapEntryCount(mapMarineLife);
    logger.info(
      `${numPlayers} Players, ${numTrash} Trash items and ${numMarineLife} Marine Life`
    );
  }, 5000);

  setInterval(() => {
    emitPlayerCount();
  }, 5000);

  // Emit combined server metrics for the Object Monitor (~3Hz for smoother countdown)
  setAsyncInterval("server.metrics.broadcast", async () => {
    try {
      const info = ENABLE_COHERENCE_BACKEND
        ? localPlayersInfo
        : mapPlayersInfo;
      const counts = {
        trash: await mapEntryCount(mapTrash),
        marine: await mapEntryCount(mapMarineLife),
        powerups: await mapEntryCount(mapPowerUps),
      };
      const { humans } = countHumansAndBots(info);
      const targets = computeEffectiveTargets(humans);
      let roomStats = { active: 0, waiting: 0, starting: 0, running: 0, ended: 0 };
      try {
        roomStats = summarizeRoomsForObservability(await buildRoomsPayload());
      } catch (_) {}
      const globalMetrics = buildMetricsObject(
        info,
        counts,
        targets,
        roomStats,
        { connections: io.engine?.clientsCount || io.of("/").sockets.size || 0 }
      );
      globalMetrics.scope = "global";
      try { updateRuntimeMetrics(globalMetrics, gameState); } catch (_) {}
      io.volatile.compress(true).emit("server.metrics", globalMetrics);

      const rooms = Array.from(new Set([DEFAULT_ROOM_ID, ...listActiveRooms()]))
        .filter((room) => room && shouldSyncVisualItems(room));
      if (!rooms.length) {
        return;
      }

      await Promise.all(rooms.map(async (room) => {
        const roomInfo = await getPlayersInfoForRoom(room);
        const roomCounts = await countItemsForRoom(room);
        const roomHumans = Math.max(
          0,
          Object.entries(roomInfo || {}).filter(([id, value]) => !isBotProfile(value, id)).length
        );
        const roomMetrics = buildMetricsObject(
          roomInfo,
          roomCounts,
          computeEffectiveTargets(roomHumans),
          roomStats,
          globalMetrics.sockets
        );
        roomMetrics.scope = "room";
        roomMetrics.room = room;
        roomMetrics.global = {
          players: globalMetrics.players,
          items: globalMetrics.items,
          rooms: globalMetrics.rooms,
          sockets: globalMetrics.sockets,
        };
        io.to(room).volatile.compress(true).emit("server.metrics", roomMetrics);
      }));
    } catch (e) {
      logger.error(`server.metrics error: ${e && e.message ? e.message : e}`);
    }
  }, METRICS_BROADCAST_MS);

  httpServer.listen(port, () =>
    logger.info(`Server listening to port ${port}`)
  );
}

async function writeCache(cache, id, value) {
  try {
    if (cache === mapPlayersInfo) localPlayersInfo[id] = value;
    if (cache === mapPlayersTraces) localPlayerTraces[id] = value;
    if (cache === mapTrash) localTrash[id] = value;
    if (cache === mapMarineLife) localMarineLife[id] = value;
    if (cache === mapPowerUps) localPowerUps[id] = value;
    if (cache === mapRooms) localRooms[id] = value;
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
    const mirror = localMirrorForCache(cache);
    if (mirror && id) return mirror[id];
  }
}

async function deleteCache(cache, id) {
  if (!id) return;
  try {
    if (cache === mapPlayersInfo) delete localPlayersInfo[id];
    if (cache === mapPlayersTraces) delete localPlayerTraces[id];
    if (cache === mapTrash) delete localTrash[id];
    if (cache === mapMarineLife) delete localMarineLife[id];
    if (cache === mapPowerUps) delete localPowerUps[id];
    if (cache === mapRooms) delete localRooms[id];
    await cache.delete(id);
  } catch (error) {
    logger.error(`Error deleting ${id}. ${error.message}`);
  }
}

function localMirrorForCache(cache) {
  if (cache === mapPlayersInfo) return localPlayersInfo;
  if (cache === mapPlayersTraces) return localPlayerTraces;
  if (cache === mapTrash) return localTrash;
  if (cache === mapMarineLife) return localMarineLife;
  if (cache === mapPowerUps) return localPowerUps;
  if (cache === mapRooms) return localRooms;
  return null;
}

function cacheLabel(cache) {
  if (cache === mapPlayersInfo) return "playersInfo";
  if (cache === mapPlayersTraces) return "playerTraces";
  if (cache === mapTrash) return "trash";
  if (cache === mapMarineLife) return "marineLife";
  if (cache === mapPowerUps) return "powerUps";
  if (cache === mapRooms) return "rooms";
  return "unknown";
}

async function readCacheEntries(cache) {
  const fallback = () => {
    const mirror = localMirrorForCache(cache);
    if (mirror) return { ...mirror };
    return {};
  };
  return coherenceEntryReader.readEntries(cache, {
    fallback,
    label: cacheLabel(cache),
  });
}

async function mapEntryCount(mapLike) {
  try {
    return countMirroredMapEntries(mapLike, {
      coherenceEnabled: ENABLE_COHERENCE_BACKEND,
      mapPlayersInfo,
      mapPlayersTraces,
      mapTrash,
      mapMarineLife,
      mapPowerUps,
      mapRooms,
      localPlayersInfo,
      localPlayerTraces,
      localTrash,
      localMarineLife,
      localPowerUps,
      localRooms,
    });
  } catch (error) {
    logger.error(`Error counting entries. ${error.message}`);
    return 0;
  }
}
