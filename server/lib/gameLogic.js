/**
 * Shared game logic utilities extracted for unit testing.
 * These functions mirror the logic used in server/server.js.
 */

/**
 * Clamp number between lo and hi
 */
export const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Iterative Fibonacci (non-recursive), returns F(n) with F(0)=0, F(1)=1
 */
export function fib(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Normalize a room identifier:
 * - Trim/uppercase
 * - Keep only A-Z 0-9 - _
 * - Max length 24
 * - Return null if empty after normalization
 */
export function normalizeRoom(r) {
  if (!r) return null;
  const s = String(r).trim().toUpperCase();
  if (!s) return null;
  const cleaned = s.replace(/[^A-Z0-9\-_]/g, "").slice(0, 24);
  return cleaned || null;
}

export function resolveJoiningRoom({ requestedRoom, socketRoom, defaultRoom = "ROOM-0001" } = {}) {
  return (
    normalizeRoom(requestedRoom) ||
    normalizeRoom(socketRoom) ||
    normalizeRoom(defaultRoom) ||
    "ROOM-0001"
  );
}

/**
 * Compute target item counts given players and spawn mode.
 * Params:
 *  - mode: "fibonacci" | "proportional"
 *  - params: {
 *      k, tr, mr, pr,                     // proportional factors
 *      fibTTrash, fibTMarine, fibTPU,     // fibonacci offsets
 *      clampTrash, clampMarine, clampPU   // clamps
 *    }
 *  - humans: number of human players
 */
export function computeTargets(mode, params, humans) {
  const p = Math.max(0, parseInt(humans || 0));
  let targetTrash = 0, targetMarine = 0, targetPU = 0;

  if (mode === "fibonacci") {
    const baseAdd = 1;
    const tTrash = fib(p + (params?.fibTTrash ?? 0));
    const tMarine = fib(p + (params?.fibTMarine ?? 0));
    const tPU = fib(Math.max(0, p + (params?.fibTPU ?? 0)));
    targetTrash = baseAdd + tTrash;
    targetMarine = baseAdd + tMarine;
    // Power-ups: mild growth bounded by p
    targetPU = baseAdd + Math.min(p, tPU);
  } else {
    const k = params?.k ?? 1;
    const tr = params?.tr ?? 1;   // trash ratio
    const mr = params?.mr ?? 2;   // marine ratio
    const pr = params?.pr ?? 0.2; // powerup ratio
    targetTrash = Math.ceil(k * p * tr);
    targetMarine = Math.ceil(k * p * mr);
    targetPU = Math.ceil(k * p * pr);
  }

  const clampT = params?.clampTrash ?? 500;
  const clampM = params?.clampMarine ?? 1000;
  const clampP = params?.clampPU ?? 50;

  return {
    trash: clampNum(targetTrash, 0, clampT),
    marine: clampNum(targetMarine, 0, clampM),
    powerups: clampNum(targetPU, 0, clampP),
  };
}

/**
 * World scaling:
 * Given current humans and a scaling config, return { x, z } world size.
 * scale = sqrt(players/basePlayers), clamped to min/max bounds.
 */
export function recomputeWorldSize(humans, worldScaleCfg) {
  const p = Math.max(1, parseInt(humans || 1));
  const basePlayers = Math.max(1, parseInt(worldScaleCfg?.basePlayers ?? 4));
  const baseX = parseInt(worldScaleCfg?.baseX ?? 88);
  const baseZ = parseInt(worldScaleCfg?.baseZ ?? 22);
  const minX = parseInt(worldScaleCfg?.minX ?? Math.round(baseX * 0.5));
  const minZ = parseInt(worldScaleCfg?.minZ ?? Math.round(baseZ * 0.5));
  const maxX = parseInt(worldScaleCfg?.maxX ?? Math.round(baseX * 2));
  const maxZ = parseInt(worldScaleCfg?.maxZ ?? Math.round(baseZ * 4));

  const scale = Math.sqrt(p / basePlayers);
  const x = clampNum(Math.round(baseX * scale), minX, maxX);
  const z = clampNum(Math.round(baseZ * scale), minZ, maxZ);
  return { x, z };
}

export const DEFAULT_COLLISION_VALIDATE_RADIUS = 1.6;

export function resolveCollisionValidateRadius(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_COLLISION_VALIDATE_RADIUS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_COLLISION_VALIDATE_RADIUS;
}

function positiveNumber(value, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export const DEFAULT_SERVER_AUTH_SPEED_LIMIT = 4.5;

export function resolveServerAuthSpeedLimit(value) {
  return positiveNumber(value, DEFAULT_SERVER_AUTH_SPEED_LIMIT);
}

export function resolveAuthoritativeBoatTypes(env = {}) {
  return {
    speed: {
      maxSpeed: positiveNumber(env.BOAT_SPEED_MAX_SPEED, 3, DEFAULT_SERVER_AUTH_SPEED_LIMIT),
      handling: 0.8,
      capacity: 5,
      mass: 1000,
      drag: 1.5,
      angularDrag: 0.05,
      acceleration: 6,
      brake: 3,
      turnSpeed: 0.55,
      driftFactor: 0.1,
    },
    fishing: {
      maxSpeed: positiveNumber(env.BOAT_FISHING_MAX_SPEED, 2.35, DEFAULT_SERVER_AUTH_SPEED_LIMIT),
      handling: 0.6,
      capacity: 15,
      mass: 2000,
      drag: 1.7,
      angularDrag: 0.15,
      acceleration: 4.5,
      brake: 3.2,
      turnSpeed: 0.45,
      driftFactor: 0.05,
    },
    rescue: {
      maxSpeed: positiveNumber(env.BOAT_RESCUE_MAX_SPEED, 2.75, DEFAULT_SERVER_AUTH_SPEED_LIMIT),
      handling: 0.7,
      capacity: 10,
      mass: 1500,
      drag: 1.6,
      angularDrag: 0.1,
      acceleration: 5.2,
      brake: 3.4,
      turnSpeed: 0.5,
      driftFactor: 0.08,
    },
  };
}

export const DEFAULT_SPAWN_PLAYER_CLEAR_RADIUS = 4;

function distanceSq2d(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dz = Number(a?.z || 0) - Number(b?.z || 0);
  return dx * dx + dz * dz;
}

export function chooseSpawnPositionAwayFromPlayers({
  players = [],
  coordinateFactory,
  worldSizeX = 88,
  worldSizeZ = 22,
  clearRadius = DEFAULT_SPAWN_PLAYER_CLEAR_RADIUS,
  attempts = 24,
} = {}) {
  const coord = typeof coordinateFactory === "function"
    ? coordinateFactory
    : (size) => Math.round((Math.random() - 0.5) * (Number(size || 1) - 1));
  const activePlayers = (Array.isArray(players) ? players : [])
    .map((player) => ({
      x: Number(player?.x),
      z: Number(player?.z),
    }))
    .filter((player) => Number.isFinite(player.x) && Number.isFinite(player.z));
  const tries = Math.max(1, Number(attempts) || 1);
  const radius = Math.max(0, Number(clearRadius) || 0);
  const minDistanceSq = radius * radius;
  let best = null;
  let bestDistanceSq = -1;

  for (let i = 0; i < tries; i += 1) {
    const candidate = {
      x: coord(worldSizeX),
      y: 0,
      z: coord(worldSizeZ),
    };
    if (!activePlayers.length || radius <= 0) return candidate;
    const nearestSq = activePlayers.reduce(
      (nearest, player) => Math.min(nearest, distanceSq2d(candidate, player)),
      Number.POSITIVE_INFINITY
    );
    if (nearestSq >= minDistanceSq) return candidate;
    if (nearestSq > bestDistanceSq) {
      best = candidate;
      bestDistanceSq = nearestSq;
    }
  }

  return best || { x: coord(worldSizeX), y: 0, z: coord(worldSizeZ) };
}

export const MAX_PLAYER_SESSION_HISTORY = 20;

export function normalizePlayerName(value, fallback = "Player") {
  const raw = value == null ? "" : String(value).trim();
  const singleLine = raw.replace(/\s+/g, " ").slice(0, 80);
  return singleLine || fallback;
}

export function buildPlayerSessionProfile(existing = {}, input = {}, nowIso = new Date().toISOString()) {
  const id = input.id || existing.id || null;
  const room = input.room || existing.room || "GLOBAL";
  const name = normalizePlayerName(input.name ?? existing.name);
  const clientSessionId = input.clientSessionId || existing.clientSessionId || id || null;
  const gameplaySessionId = input.gameplaySessionId || existing.gameplaySessionId || null;
  const sessionKey = [clientSessionId || "client", gameplaySessionId || "lobby", room].join(":");
  const prior = Array.isArray(existing.sessions) ? existing.sessions.slice() : [];
  const sessions = prior.filter((entry) => entry && entry.sessionKey !== sessionKey);
  const previous = prior.find((entry) => entry && entry.sessionKey === sessionKey) || {};
  sessions.push({
    ...previous,
    sessionKey,
    clientSessionId,
    gameplaySessionId,
    room,
    name,
    firstSeenAt: previous.firstSeenAt || nowIso,
    updatedAt: nowIso,
  });
  const trimmedSessions = sessions.slice(-MAX_PLAYER_SESSION_HISTORY);
  return {
    ...existing,
    id,
    name,
    displayName: name,
    room,
    clientSessionId,
    gameplaySessionId,
    updatedAt: nowIso,
    sessions: trimmedSessions,
  };
}
