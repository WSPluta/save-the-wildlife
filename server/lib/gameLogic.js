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

export function canonicalRoomId(room, defaultRoom = "ROOM-0001") {
  return normalizeRoom(room) || normalizeRoom(defaultRoom) || "ROOM-0001";
}

export function normalizeStartPosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y || 0);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, y: Number.isFinite(y) ? y : 0, z };
}

export function normalizeStartPositions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const positions = {};
  for (const [playerId, position] of Object.entries(value)) {
    const parsed = normalizeStartPosition(position);
    if (playerId && parsed) positions[playerId] = parsed;
  }
  return Object.keys(positions).length ? positions : null;
}

export function normalizeRoomStateRecord(room, state = {}, {
  defaultRoom = "ROOM-0001",
  durationSeconds = 60,
  now = Date.now(),
} = {}) {
  const safeRoom = canonicalRoomId(room, defaultRoom);
  const rawState = String(state?.state || "WAITING").toUpperCase();
  const allowedState = ["WAITING", "STARTING", "RUNNING", "ENDED"].includes(rawState)
    ? rawState
    : "WAITING";
  const startTime = Number(state?.startTime);
  const startingAt = Number(state?.startingAt);
  const updatedAt = Number(state?.updatedAt);
  const adminId = String(state?.adminId || state?.roomAdminId || "").trim() || null;
  return {
    room: safeRoom,
    state: allowedState,
    startTime: Number.isFinite(startTime) && startTime > 0 ? startTime : null,
    startingAt: Number.isFinite(startingAt) && startingAt > 0 ? startingAt : null,
    adminId,
    startPosition: normalizeStartPosition(state?.startPosition),
    startPositions: normalizeStartPositions(state?.startPositions),
    ownerServerId: state?.ownerServerId || null,
    durationSeconds: Number.isFinite(Number(state?.durationSeconds))
      ? Math.max(1, Number(state.durationSeconds))
      : Math.max(1, Number(durationSeconds) || 60),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now,
  };
}

export function selectCanonicalRoomState(local, cached) {
  if (!cached) return local || null;
  if (!local) return cached;
  return Number(cached.updatedAt || 0) >= Number(local.updatedAt || 0)
    ? cached
    : local;
}

export function persistedRoomState(room, state = {}, options = {}) {
  const normalized = normalizeRoomStateRecord(room, state, options);
  return {
    state: normalized.state,
    startTime: normalized.startTime,
    startingAt: normalized.startingAt,
    adminId: normalized.adminId,
    startPosition: normalized.startPosition,
    startPositions: normalized.startPositions,
    ownerServerId: normalized.ownerServerId,
    durationSeconds: normalized.durationSeconds,
    updatedAt: normalized.updatedAt,
  };
}

export function roomStartPositionForPlayer(state = {}, playerId) {
  const own = state?.startPositions && playerId ? normalizeStartPosition(state.startPositions[playerId]) : null;
  return own || normalizeStartPosition(state?.startPosition) || { x: 0, y: 0, z: 0 };
}

export function roomRemainingSeconds(state = {}, {
  durationSeconds = 60,
  now = Date.now(),
} = {}) {
  const duration = Math.max(1, Number(state.durationSeconds || durationSeconds) || 60);
  const startTime = Number(state.startTime || 0);
  if (!startTime) return duration;
  const remaining = (duration * 1000) - (now - startTime);
  return Math.max(0, Math.round(remaining / 1000));
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

export const DEFAULT_COLLISION_VALIDATE_RADIUS = 3.6;
export const DEFAULT_ITEM_COLLISION_RADIUS = 0.95;
export const TURTLE_ITEM_COLLISION_RADIUS = 1.35;
export const POWERUP_ITEM_COLLISION_RADIUS = 1.05;
export const DEFAULT_PICKUP_TOUCH_FORGIVENESS = 0.3;
export const TRASH_FOOTPRINT_HALF_WIDTH = 0.5;
export const TRASH_FOOTPRINT_HALF_DEPTH = 0.33;
export const TRASH_VISUAL_SCALE_MIN = 1.08;
export const TRASH_VISUAL_SCALE_MAX = 1.42;

export function resolveCollisionValidateRadius(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_COLLISION_VALIDATE_RADIUS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_COLLISION_VALIDATE_RADIUS;
}

export function resolveItemCollisionRadius(itemType, item = {}) {
  const type = String(item?.type || itemType || "");
  if (type === "turtle") return TURTLE_ITEM_COLLISION_RADIUS;
  if (type.startsWith("powerup_") || itemType === "powerup") return POWERUP_ITEM_COLLISION_RADIUS;
  return DEFAULT_ITEM_COLLISION_RADIUS;
}

export function resolvePickupTouchForgiveness(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PICKUP_TOUCH_FORGIVENESS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(parsed, 0.5)
    : DEFAULT_PICKUP_TOUCH_FORGIVENESS;
}

export function clampTrashVisualScale(size) {
  const parsed = Number(size);
  const scale = Number.isFinite(parsed) ? parsed : 1;
  return Math.max(TRASH_VISUAL_SCALE_MIN, Math.min(TRASH_VISUAL_SCALE_MAX, scale));
}

export function isTrashBoxFootprintOverlap({ dx, dz, boatRadius, itemSize, forgiveness } = {}) {
  const safeBoatRadius = Math.max(0, Number(boatRadius) || 0);
  const safeForgiveness = Math.max(0, Number(forgiveness) || 0);
  const scale = clampTrashVisualScale(itemSize);
  return Math.abs(Number(dx) || 0) <= safeBoatRadius + TRASH_FOOTPRINT_HALF_WIDTH * scale + safeForgiveness
    && Math.abs(Number(dz) || 0) <= safeBoatRadius + TRASH_FOOTPRINT_HALF_DEPTH * scale + safeForgiveness;
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
      handling: 0.95,
      capacity: 5,
      mass: 1000,
      drag: 1.5,
      angularDrag: 0.05,
      acceleration: 6,
      brake: 3,
      turnSpeed: 0.82,
      collisionRadius: 1.25,
      driftFactor: 0.1,
    },
    fishing: {
      maxSpeed: positiveNumber(env.BOAT_FISHING_MAX_SPEED, 2.35, DEFAULT_SERVER_AUTH_SPEED_LIMIT),
      handling: 0.8,
      capacity: 15,
      mass: 2000,
      drag: 1.7,
      angularDrag: 0.15,
      acceleration: 4.5,
      brake: 3.2,
      turnSpeed: 0.72,
      collisionRadius: 1.45,
      driftFactor: 0.05,
    },
    rescue: {
      maxSpeed: positiveNumber(env.BOAT_RESCUE_MAX_SPEED, 2.75, DEFAULT_SERVER_AUTH_SPEED_LIMIT),
      handling: 0.85,
      capacity: 10,
      mass: 1500,
      drag: 1.6,
      angularDrag: 0.1,
      acceleration: 5.2,
      brake: 3.4,
      turnSpeed: 0.76,
      collisionRadius: 1.35,
      driftFactor: 0.08,
    },
  };
}

export function countMirroredMapEntries(mapLike, {
  coherenceEnabled = false,
  mapPlayersInfo,
  mapPlayersTraces,
  mapTrash,
  mapMarineLife,
  mapPowerUps,
  mapRooms,
  localPlayersInfo = {},
  localPlayerTraces = {},
  localTrash = {},
  localMarineLife = {},
  localPowerUps = {},
  localRooms = {},
} = {}) {
  if (!mapLike) return 0;
  if (!coherenceEnabled) return Object.keys(mapLike).length;
  if (mapLike === mapPlayersInfo) return Object.keys(localPlayersInfo).length;
  if (mapLike === mapPlayersTraces) return Object.keys(localPlayerTraces).length;
  if (mapLike === mapTrash) return Object.keys(localTrash).length;
  if (mapLike === mapMarineLife) return Object.keys(localMarineLife).length;
  if (mapLike === mapPowerUps) return Object.keys(localPowerUps).length;
  if (mapLike === mapRooms) return Object.keys(localRooms).length;
  return 0;
}

export const DEFAULT_SPAWN_PLAYER_CLEAR_RADIUS = 4;
export const DEFAULT_START_POSITION_ITEM_CLEAR_RADIUS = 6;

function distanceSq2d(a, b) {
  const dx = Number(a?.x || 0) - Number(b?.x || 0);
  const dz = Number(a?.z || 0) - Number(b?.z || 0);
  return dx * dx + dz * dz;
}

export function isPositionWithinRadius2d(a, b, radius) {
  const r = Math.max(0, Number(radius) || 0);
  return distanceSq2d(a, b) < r * r;
}

function normalizePositions(positions = []) {
  return (Array.isArray(positions) ? positions : [])
    .map((position) => ({
      x: Number(position?.x),
      z: Number(position?.z),
    }))
    .filter((position) => Number.isFinite(position.x) && Number.isFinite(position.z));
}

function nearestDistanceSq2d(candidate, positions) {
  if (!positions.length) return Number.POSITIVE_INFINITY;
  return positions.reduce(
    (nearest, position) => Math.min(nearest, distanceSq2d(candidate, position)),
    Number.POSITIVE_INFINITY
  );
}

function worldAxisBounds(size) {
  const span = Math.max(1, Math.floor(Number(size) || 1));
  const half = (span - 1) / 2;
  return {
    min: -Math.floor(half),
    max: Math.ceil(half),
  };
}

function evaluateSpawnCandidate(candidate, requiredPositions, preferredPositions) {
  const nearestRequiredSq = nearestDistanceSq2d(candidate, requiredPositions);
  const nearestPreferredSq = nearestDistanceSq2d(candidate, preferredPositions);
  return {
    position: candidate,
    nearestRequiredSq,
    nearestPreferredSq,
    centerDistanceSq: distanceSq2d(candidate, { x: 0, z: 0 }),
  };
}

function isBetterSpawnCandidate(candidate, best) {
  if (!best) return true;
  if (candidate.nearestPreferredSq !== best.nearestPreferredSq) {
    return candidate.nearestPreferredSq > best.nearestPreferredSq;
  }
  if (candidate.nearestRequiredSq !== best.nearestRequiredSq) {
    return candidate.nearestRequiredSq > best.nearestRequiredSq;
  }
  if (candidate.centerDistanceSq !== best.centerDistanceSq) {
    return candidate.centerDistanceSq < best.centerDistanceSq;
  }
  if (candidate.position.x !== best.position.x) {
    return candidate.position.x < best.position.x;
  }
  return candidate.position.z < best.position.z;
}

function findDeterministicSpawnCandidate({
  requiredPositions,
  preferredPositions,
  worldSizeX,
  worldSizeZ,
  minDistanceSq,
  requirePreferredClear,
}) {
  const boundsX = worldAxisBounds(worldSizeX);
  const boundsZ = worldAxisBounds(worldSizeZ);
  let best = null;

  for (let x = boundsX.min; x <= boundsX.max; x += 1) {
    for (let z = boundsZ.min; z <= boundsZ.max; z += 1) {
      const candidate = evaluateSpawnCandidate(
        { x, y: 0, z },
        requiredPositions,
        preferredPositions
      );
      if (candidate.nearestRequiredSq < minDistanceSq) continue;
      if (requirePreferredClear && candidate.nearestPreferredSq < minDistanceSq) continue;
      if (isBetterSpawnCandidate(candidate, best)) best = candidate;
    }
  }

  return best ? best.position : null;
}

export function chooseSpawnPositionAwayFromPlayers({
  players = [],
  requiredPlayers,
  coordinateFactory,
  worldSizeX = 128,
  worldSizeZ = 42,
  clearRadius = DEFAULT_SPAWN_PLAYER_CLEAR_RADIUS,
  attempts = 24,
} = {}) {
  const coord = typeof coordinateFactory === "function"
    ? coordinateFactory
    : (size) => Math.round((Math.random() - 0.5) * (Number(size || 1) - 1));
  const preferredPositions = normalizePositions(players);
  const requiredPositions = requiredPlayers === undefined
    ? preferredPositions
    : normalizePositions(requiredPlayers);
  const tries = Math.max(1, Number(attempts) || 1);
  const radius = Math.max(0, Number(clearRadius) || 0);
  const minDistanceSq = radius * radius;
  let best = null;
  let bestRequiredClear = null;

  for (let i = 0; i < tries; i += 1) {
    const candidate = {
      x: coord(worldSizeX),
      y: 0,
      z: coord(worldSizeZ),
    };
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.z)) continue;
    if ((!requiredPositions.length && !preferredPositions.length) || radius <= 0) return candidate;
    const evaluated = evaluateSpawnCandidate(candidate, requiredPositions, preferredPositions);
    if (evaluated.nearestRequiredSq >= minDistanceSq && evaluated.nearestPreferredSq >= minDistanceSq) {
      return candidate;
    }
    if (evaluated.nearestRequiredSq >= minDistanceSq && isBetterSpawnCandidate(evaluated, bestRequiredClear)) {
      bestRequiredClear = evaluated;
    }
    if (isBetterSpawnCandidate(evaluated, best)) best = evaluated;
  }

  const requiredAndPreferredClear = findDeterministicSpawnCandidate({
    requiredPositions,
    preferredPositions,
    worldSizeX,
    worldSizeZ,
    minDistanceSq,
    requirePreferredClear: true,
  });
  if (requiredAndPreferredClear) return requiredAndPreferredClear;

  const requiredClear = findDeterministicSpawnCandidate({
    requiredPositions,
    preferredPositions,
    worldSizeX,
    worldSizeZ,
    minDistanceSq,
    requirePreferredClear: false,
  });
  if (requiredClear) return requiredClear;

  if (bestRequiredClear) return bestRequiredClear.position;
  if (best) return best.position;

  const fallback = { x: coord(worldSizeX), y: 0, z: coord(worldSizeZ) };
  return Number.isFinite(fallback.x) && Number.isFinite(fallback.z)
    ? fallback
    : { x: 0, y: 0, z: 0 };
}

export function buildStartPositionItemRelocations({
  items = {},
  startPosition,
  coordinateFactory,
  worldSizeX = 128,
  worldSizeZ = 42,
  clearRadius = DEFAULT_START_POSITION_ITEM_CLEAR_RADIUS,
  attempts = 48,
} = {}) {
  const start = {
    x: Number(startPosition?.x),
    z: Number(startPosition?.z),
  };
  if (!Number.isFinite(start.x) || !Number.isFinite(start.z)) return [];

  const radius = Math.max(0, Number(clearRadius) || 0);
  if (radius <= 0) return [];
  const radiusSq = radius * radius;
  const parsedItems = Object.entries(items || {})
    .map(([id, item]) => ({
      id,
      item,
      position: {
        x: Number(item?.position?.x),
        z: Number(item?.position?.z),
      },
    }))
    .filter(({ id, position }) => (
      id &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.z)
    ))
    .map((entry) => ({
      ...entry,
      distanceSq: distanceSq2d(entry.position, start),
    }));

  const blockedPositions = [
    start,
    ...parsedItems
      .filter((entry) => entry.distanceSq >= radiusSq)
      .map((entry) => entry.position),
  ];
  const relocations = [];

  for (const entry of parsedItems) {
    if (entry.distanceSq >= radiusSq) continue;
    const position = chooseSpawnPositionAwayFromPlayers({
      players: blockedPositions,
      requiredPlayers: [start],
      coordinateFactory,
      worldSizeX,
      worldSizeZ,
      clearRadius: radius,
      attempts,
    });
    relocations.push({
      id: entry.id,
      position,
    });
    blockedPositions.push({ x: position.x, z: position.z });
  }

  return relocations;
}

export function buildOpeningCollectiblePositions({
  startPosition,
  existingItems = {},
  count = 3,
  ringRadius = 8,
  clearRadius = DEFAULT_START_POSITION_ITEM_CLEAR_RADIUS,
  minSpacing = 3.5,
  worldSizeX = 128,
  worldSizeZ = 42,
} = {}) {
  const start = {
    x: Number(startPosition?.x),
    z: Number(startPosition?.z),
  };
  if (!Number.isFinite(start.x) || !Number.isFinite(start.z)) return [];

  const wanted = Math.max(0, Math.floor(Number(count) || 0));
  if (wanted <= 0) return [];

  const boundsX = worldAxisBounds(worldSizeX);
  const boundsZ = worldAxisBounds(worldSizeZ);
  const safeRadius = Math.max(0, Number(clearRadius) || 0);
  const radius = Math.max(safeRadius + 1.25, Number(ringRadius) || 8);
  const spacing = Math.max(0, Number(minSpacing) || 0);
  const selected = [];
  const existingPositions = normalizePositions(
    Object.values(existingItems || {}).map((item) => item?.position || item)
  );

  const clampPosition = (candidate) => ({
    x: clampNum(Math.round(candidate.x), boundsX.min, boundsX.max),
    y: 0,
    z: clampNum(Math.round(candidate.z), boundsZ.min, boundsZ.max),
  });
  const canUse = (position) => {
    if (isPositionWithinRadius2d(position, start, safeRadius)) return false;
    if (spacing > 0 && existingPositions.some((existing) => isPositionWithinRadius2d(position, existing, spacing))) {
      return false;
    }
    if (spacing > 0 && selected.some((existing) => isPositionWithinRadius2d(position, existing, spacing))) {
      return false;
    }
    return true;
  };
  const addCandidate = (candidate) => {
    if (selected.length >= wanted) return;
    const position = clampPosition(candidate);
    if (canUse(position)) selected.push(position);
  };

  const ringOffsets = [
    { x: 0, z: radius },
    { x: -radius * 0.72, z: radius * 0.46 },
    { x: radius * 0.72, z: radius * 0.46 },
    { x: -radius * 0.54, z: -radius * 0.64 },
    { x: radius * 0.54, z: -radius * 0.64 },
    { x: -radius, z: 0 },
    { x: radius, z: 0 },
    { x: 0, z: -radius },
  ];
  for (const offset of ringOffsets) {
    addCandidate({ x: start.x + offset.x, z: start.z + offset.z });
  }

  if (selected.length >= wanted) return selected;

  const fallback = [];
  for (let x = boundsX.min; x <= boundsX.max; x += 1) {
    for (let z = boundsZ.min; z <= boundsZ.max; z += 1) {
      const position = { x, y: 0, z };
      if (!canUse(position)) continue;
      fallback.push({
        position,
        ringError: Math.abs(Math.sqrt(distanceSq2d(position, start)) - radius),
        centerDistanceSq: distanceSq2d(position, { x: 0, z: 0 }),
      });
    }
  }
  fallback.sort((a, b) => {
    if (a.ringError !== b.ringError) return a.ringError - b.ringError;
    if (a.centerDistanceSq !== b.centerDistanceSq) return a.centerDistanceSq - b.centerDistanceSq;
    if (a.position.x !== b.position.x) return a.position.x - b.position.x;
    return a.position.z - b.position.z;
  });

  for (const entry of fallback) {
    addCandidate(entry.position);
    if (selected.length >= wanted) break;
  }

  return selected;
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
  const isBot = input.isBot ?? existing.isBot ?? false;
  const teacher = input.teacher || existing.teacher || null;
  const botPolicy = input.botPolicy && typeof input.botPolicy === "object"
    ? input.botPolicy
    : (existing.botPolicy && typeof existing.botPolicy === "object" ? existing.botPolicy : null);
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
    isBot,
    teacher,
    botPolicy,
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
    isBot,
    teacher,
    botPolicy,
    updatedAt: nowIso,
    sessions: trimmedSessions,
  };
}
