import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  clampNum,
  DEFAULT_COLLISION_VALIDATE_RADIUS,
  DEFAULT_PICKUP_TOUCH_FORGIVENESS,
  DEFAULT_SERVER_AUTH_SPEED_LIMIT,
  MAX_PLAYER_SESSION_HISTORY,
  buildPlayerSessionProfile,
  fib,
  normalizeRoom,
  canonicalRoomId,
  resolveJoiningRoom,
  normalizePlayerName,
  normalizeRoomScores,
  computeTargets,
  recomputeWorldSize,
  resolveAuthoritativeBoatTypes,
  resolveCollisionValidateRadius,
  resolveItemCollisionRadius,
  resolvePickupTouchForgiveness,
  resolveServerAuthSpeedLimit,
  clampTrashVisualScale,
  isTrashBoxFootprintOverlap,
  countMirroredMapEntries,
  chooseSpawnPositionAwayFromPlayers,
  buildStartPositionItemRelocations,
  buildOpeningCollectiblePositions,
  isPositionWithinRadius2d,
  normalizeRoomStateRecord,
  normalizeStartPosition,
  normalizeStartPositions,
  persistedRoomState,
  roomRemainingSeconds,
  roomStartPositionForPlayer,
  selectCanonicalRoomState,
  softClampWorldPosition,
  worldBoundaryExtents,
} from "../lib/gameLogic.js";

describe("clampNum", () => {
  it("clamps within range", () => {
    expect(clampNum(5, 0, 10)).toBe(5);
    expect(clampNum(-1, 0, 10)).toBe(0);
    expect(clampNum(99, 0, 10)).toBe(10);
  });
});

describe("fib", () => {
  it("computes fibonacci correctly", () => {
    const seq = Array.from({ length: 11 }, (_, n) => fib(n));
    expect(seq).toEqual([0,1,1,2,3,5,8,13,21,34,55]);
    expect(fib(0)).toBe(0);
    expect(fib(1)).toBe(1);
    expect(fib(10)).toBe(55);
  });
});

describe("normalizeRoom", () => {
  it("normalizes room id with uppercase and allowed chars only", () => {
    expect(normalizeRoom("  room-001  ")).toBe("ROOM-001");
    expect(normalizeRoom("rm@#$%abc123")).toBe("RMABC123");
    expect(normalizeRoom("lower_upper-123")).toBe("LOWER_UPPER-123");
  });
  it("returns null on empty/invalid", () => {
    expect(normalizeRoom("   ")).toBeNull();
    expect(normalizeRoom("!!!")).toBeNull();
    expect(normalizeRoom(null)).toBeNull();
  });
  it("caps at 24 chars", () => {
    const long = "ROOM-THIS-IS-A-VERY-LONG-IDENTIFIER-123456";
    const norm = normalizeRoom(long);
    expect(norm.length).toBeLessThanOrEqual(24);
  });
});

describe("resolveJoiningRoom", () => {
  it("prefers the requested room over the socket default room", () => {
    expect(resolveJoiningRoom({
      requestedRoom: "room-dynamic",
      socketRoom: "ROOM-0001",
      defaultRoom: "ROOM-0001",
    })).toBe("ROOM-DYNAMIC");
  });

  it("falls back to socket room and then default room", () => {
    expect(resolveJoiningRoom({ socketRoom: "room-socket", defaultRoom: "ROOM-0001" })).toBe("ROOM-SOCKET");
    expect(resolveJoiningRoom({ defaultRoom: "ROOM-0001" })).toBe("ROOM-0001");
  });
});

describe("room-scoped initial sync", () => {
  it("waits for room join before sending authoritative item snapshots", () => {
    const serverSource = readFileSync("server.js", "utf8");
    expect(serverSource).not.toMatch(/getItemsForRoom\(DEFAULT_ROOM_ID\)/);
    expect(serverSource).toMatch(/Room-scoped state is emitted after player\.info\.joining\/room\.join/);
    expect(serverSource).toMatch(/socket\.emit\("items\.all", itemsForRoom\);/);
  });
});

describe("canonical room state helpers", () => {
  it("normalizes room ids and start positions for persistence", () => {
    expect(canonicalRoomId(" room-x ", "ROOM-0001")).toBe("ROOM-X");
    expect(canonicalRoomId("!!!", "room-default")).toBe("ROOM-DEFAULT");
    expect(normalizeStartPosition({ x: "1.5", y: "2", z: "-3" })).toEqual({ x: 1.5, y: 2, z: -3 });
    expect(normalizeStartPosition({ x: "bad", z: 1 })).toBeNull();
    expect(normalizeStartPositions({
      p1: { x: 1, z: 2 },
      p2: { x: "bad", z: 3 },
      p3: { x: -4, y: 0.5, z: 6 },
    })).toEqual({
      p1: { x: 1, y: 0, z: 2 },
      p3: { x: -4, y: 0.5, z: 6 },
    });
  });

  it("selects fresher shared state over stale local state for cross-pod lifecycle authority", () => {
    const localWaiting = normalizeRoomStateRecord("room-p0", {
      state: "WAITING",
      updatedAt: 100,
    }, { defaultRoom: "ROOM-0001", durationSeconds: 60, now: 100 });
    const cachedRunning = normalizeRoomStateRecord("room-p0", {
      state: "RUNNING",
      startTime: 1000,
      updatedAt: 200,
      ownerServerId: "starter-pod",
    }, { defaultRoom: "ROOM-0001", durationSeconds: 60, now: 200 });

    expect(selectCanonicalRoomState(localWaiting, cachedRunning)).toEqual(cachedRunning);
    expect(selectCanonicalRoomState(cachedRunning, localWaiting)).toEqual(cachedRunning);
    expect(selectCanonicalRoomState(null, cachedRunning)).toEqual(cachedRunning);
  });

  it("persists only canonical lifecycle fields used by every ws-server replica", () => {
    const persisted = persistedRoomState("room-persist", {
      state: "RUNNING",
      startTime: 1234,
      startingAt: 0,
      timerId: { localOnly: true },
      resetTimerId: { localOnly: true },
      ownerServerId: "server-a",
      adminId: "player-admin",
      startPosition: { x: 2, y: 0, z: 3 },
      startPositions: { p1: { x: 2, z: 3 }, p2: { x: 8, z: -4 } },
      scores: { p1: 7, p2: "-2", ignored: "bad" },
      durationSeconds: 60,
      updatedAt: 5678,
    }, { defaultRoom: "ROOM-0001", durationSeconds: 60 });

    expect(persisted).toEqual({
      state: "RUNNING",
      startTime: 1234,
      startingAt: null,
      adminId: "player-admin",
      startPosition: { x: 2, y: 0, z: 3 },
      startPositions: {
        p1: { x: 2, y: 0, z: 3 },
        p2: { x: 8, y: 0, z: -4 },
      },
      scores: { p1: 7, p2: -2 },
      ownerServerId: "server-a",
      durationSeconds: 60,
      updatedAt: 5678,
    });
    expect(persisted).not.toHaveProperty("timerId");
    expect(persisted).not.toHaveProperty("resetTimerId");
  });

  it("normalizes room score maps without dropping negative turtle penalties", () => {
    expect(normalizeRoomScores({
      p1: "9",
      p2: -3.2,
      empty: "",
      bad: "nope",
    })).toEqual({
      p1: 9,
      p2: -3,
    });
    const state = normalizeRoomStateRecord("room-score", {
      state: "RUNNING",
      scoreByPlayer: { p1: 4, p2: "-1" },
      updatedAt: 10,
    }, { defaultRoom: "ROOM-0001", durationSeconds: 60, now: 10 });
    expect(state.scores).toEqual({ p1: 4, p2: -1 });
  });

  it("uses per-player start positions when present and falls back safely", () => {
    const state = {
      startPosition: { x: 0, y: 0, z: 0 },
      startPositions: {
        p1: { x: 4, y: 0, z: 5 },
        p2: { x: -6, z: 7 },
      },
    };

    expect(roomStartPositionForPlayer(state, "p1")).toEqual({ x: 4, y: 0, z: 5 });
    expect(roomStartPositionForPlayer(state, "p2")).toEqual({ x: -6, y: 0, z: 7 });
    expect(roomStartPositionForPlayer(state, "missing")).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps game.start idempotent so repeated registration cannot reset movement", () => {
    const serverSource = readFileSync("server.js", "utf8");
    expect(serverSource).toMatch(/mapPlayerSockets\[id\] = socket;/);
    expect(serverSource).toMatch(/function ensurePlayerAuthState\(playerId, room, startPosition = null\)/);
    expect(serverSource).toMatch(/if \(playersState\.has\(playerId\)\) \{[\s\S]{0,220}if \(!playersInput\.has\(playerId\)\)[\s\S]{0,180}return;/);
    expect(serverSource).toMatch(/ensurePlayerAuthState\(playerId, room, canonicalStart\);/);
    expect(serverSource).not.toMatch(/if \(!canonicalStart && playersState\.has\(playerId\)\) return;/);
  });

  it("uses live socket room membership as a backstop for match start auth state", () => {
    const serverSource = readFileSync("server.js", "utf8");
    expect(serverSource).toMatch(/const playersFromProfiles = await listPlayersInRoom\(room, \{ includeBots: true \}\)/);
    expect(serverSource).toMatch(/const livePlayers = Array\.from\(playerRooms\.entries\(\)\)/);
    expect(serverSource).toMatch(/const players = Array\.from\(new Set\(\[\.\.\.playersFromProfiles, \.\.\.livePlayers\]\)\)\.sort\(\);/);
  });

  it("computes canonical remaining time from server start time", () => {
    expect(roomRemainingSeconds({ startTime: 10_000, durationSeconds: 60 }, { now: 10_100 })).toBe(60);
    expect(roomRemainingSeconds({ startTime: 10_000, durationSeconds: 60 }, { now: 15_200 })).toBe(55);
    expect(roomRemainingSeconds({ startTime: 10_000, durationSeconds: 60 }, { now: 80_000 })).toBe(0);
    expect(roomRemainingSeconds({}, { durationSeconds: 60, now: 20_000 })).toBe(60);
  });
});

describe("computeTargets (fibonacci)", () => {
  const params = {
    fibTTrash: 3,
    fibTMarine: 4,
    fibTPU: 2,
    clampTrash: 500,
    clampMarine: 1000,
    clampPU: 50,
  };

  it("grows with fibonacci + baseAdd and respects clamps", () => {
    // p = 0
    let t = computeTargets("fibonacci", params, 0);
    // baseAdd(1) + fib(offset)
    expect(t.trash).toBe(1 + fib(0 + params.fibTTrash));
    expect(t.marine).toBe(1 + fib(0 + params.fibTMarine));
    expect(t.powerups).toBe(1 + Math.min(0, fib(0 + params.fibTPU)));

    // p = 3
    t = computeTargets("fibonacci", params, 3);
    expect(t.trash).toBeGreaterThan(1);
    expect(t.marine).toBeGreaterThan(1);
    expect(t.powerups).toBeGreaterThanOrEqual(1);

    // clamp check with big p
    t = computeTargets("fibonacci", { ...params, clampTrash: 5 }, 1000);
    expect(t.trash).toBeLessThanOrEqual(5);
  });
});

describe("computeTargets (proportional)", () => {
  const params = { k: 1, tr: 1, mr: 2, pr: 0.2, clampTrash: 500, clampMarine: 1000, clampPU: 50 };

  it("scales linearly with players and applies ceil", () => {
    const p = 5;
    const t = computeTargets("proportional", params, p);
    // ceil(1 * 5 * 1) = 5
    expect(t.trash).toBe(5);
    // ceil(1 * 5 * 2) = 10
    expect(t.marine).toBe(10);
    // ceil(1 * 5 * 0.2) = ceil(1) = 1
    expect(t.powerups).toBe(1);
  });

  it("respects clamps", () => {
    const t = computeTargets("proportional", { ...params, clampPU: 2 }, 1000);
    expect(t.powerups).toBeLessThanOrEqual(2);
  });
});

describe("recomputeWorldSize", () => {
  const cfg = {
    baseX: 88,
    baseZ: 22,
    basePlayers: 4,
    minX: 44,
    minZ: 11,
    maxX: 176,
    maxZ: 88,
  };

  it("keeps base sizes at basePlayers and scales with sqrt(players/basePlayers)", () => {
    // p = 4 -> scale=1
    let s = recomputeWorldSize(4, cfg);
    expect(s).toEqual({ x: 88, z: 22 });

    // p = 16 -> scale = sqrt(16/4) = 2 (clamped at max)
    s = recomputeWorldSize(16, cfg);
    expect(s).toEqual({ x: 176, z: 44 }); // z doubles to 44 (max is 88)
  });

  it("clamps to min/max", () => {
    // p = 1 -> smaller than base, but >= min
    let s = recomputeWorldSize(1, cfg);
    expect(s.x).toBeGreaterThanOrEqual(cfg.minX);
    expect(s.z).toBeGreaterThanOrEqual(cfg.minZ);

    // very large -> clamp at max
    s = recomputeWorldSize(10000, cfg);
    expect(s.x).toBeLessThanOrEqual(cfg.maxX);
    expect(s.z).toBeLessThanOrEqual(cfg.maxZ);
  });
});

describe("resolveCollisionValidateRadius", () => {
  it("defaults to the legacy sanity radius; scoring uses boat/item footprints", () => {
    expect(DEFAULT_COLLISION_VALIDATE_RADIUS).toBe(3.6);
    expect(resolveCollisionValidateRadius()).toBe(3.6);
  });

  it("accepts explicit positive overrides and ignores invalid values", () => {
    expect(resolveCollisionValidateRadius("2.25")).toBe(2.25);
    expect(resolveCollisionValidateRadius("0")).toBe(3.6);
    expect(resolveCollisionValidateRadius("bad")).toBe(3.6);
  });
});

describe("resolveItemCollisionRadius", () => {
  it("keeps server pickup validation aligned to invisible gameplay primitives", () => {
    expect(resolveItemCollisionRadius("trash")).toBe(0.95);
    expect(resolveItemCollisionRadius("powerup")).toBe(1.05);
    expect(resolveItemCollisionRadius("powerup_freeze")).toBe(1.05);
    expect(resolveItemCollisionRadius("turtle")).toBe(1.35);
  });

  it("prefers the recorded item type when the cache namespace is generic", () => {
    expect(resolveItemCollisionRadius("powerup", { type: "powerup_shield" })).toBe(1.05);
    expect(resolveItemCollisionRadius("trash", { type: "turtle" })).toBe(1.35);
  });
});

describe("resolvePickupTouchForgiveness", () => {
  it("adds a small bounded tolerance for visual-model pickup edge cases", () => {
    expect(DEFAULT_PICKUP_TOUCH_FORGIVENESS).toBe(0.3);
    expect(resolvePickupTouchForgiveness()).toBe(0.3);
    expect(resolvePickupTouchForgiveness("0.18")).toBe(0.18);
    expect(resolvePickupTouchForgiveness("0")).toBe(0);
    expect(resolvePickupTouchForgiveness("5")).toBe(0.5);
    expect(resolvePickupTouchForgiveness("bad")).toBe(0.3);
  });

  it("covers the observed deployed near-miss without widening pickups across lanes", () => {
    const boat = resolveAuthoritativeBoatTypes().speed.collisionRadius;
    const trash = resolveItemCollisionRadius("trash");
    const allowed = boat + trash + resolvePickupTouchForgiveness();

    expect(allowed).toBeCloseTo(2.5);
    expect(2.224).toBeLessThanOrEqual(allowed);
    expect(2.449).toBeLessThanOrEqual(allowed);
    expect(2.75).toBeGreaterThan(allowed);
  });
});

describe("trash footprint validation", () => {
  it("matches the client trash box primitive at diagonal edges", () => {
    const boat = resolveAuthoritativeBoatTypes().speed.collisionRadius;
    const forgiveness = resolvePickupTouchForgiveness();

    expect(clampTrashVisualScale("0.50")).toBe(1.08);
    expect(isTrashBoxFootprintOverlap({
      dx: 1.9,
      dz: 1.78,
      boatRadius: boat,
      itemSize: "0.50",
      forgiveness,
    })).toBe(true);
    expect(isTrashBoxFootprintOverlap({
      dx: 2.15,
      dz: 1.95,
      boatRadius: boat,
      itemSize: "0.50",
      forgiveness,
    })).toBe(false);
  });
});

describe("resolveAuthoritativeBoatTypes collision footprints", () => {
  it("defines boat-mode collision radii for server-side pickup validation", () => {
    const types = resolveAuthoritativeBoatTypes();
    expect(types.speed.collisionRadius).toBe(1.25);
    expect(types.fishing.collisionRadius).toBe(1.45);
    expect(types.rescue.collisionRadius).toBe(1.35);
  });
});

describe("production collision configuration", () => {
  it("keeps the OKE ws-server pickup radius aligned with the server default", () => {
    const template = readFileSync("../deploy/k8s/base/ws-server/env_server_template", "utf8");
    expect(template).toContain(`COLLISION_VALIDATE_RADIUS=${DEFAULT_COLLISION_VALIDATE_RADIUS}`);
    expect(template).toContain(`PICKUP_TOUCH_FORGIVENESS=${DEFAULT_PICKUP_TOUCH_FORGIVENESS}`);
    expect(template).toContain("PAF_AGENT_TIMEOUT_MS=75000");
  });
});

describe("authoritative multiplayer lifecycle", () => {
  it("initializes player state from canonical room starts when a room is running", () => {
    const server = readFileSync("server.js", "utf8");
    expect(server).toMatch(/socket\.on\("game\.start"/);
    expect(server).toMatch(/const canonicalRoomState = await readCanonicalRoomState\(room\)/);
    expect(server).toMatch(/roomStartPositionForPlayer\(canonicalRoomState, playerId\)/);
    expect(server).not.toMatch(/SERVER_AUTH_ENABLED && matchRunning && !playersState\.has\(playerId\)/);
  });

  it("uses shared room lifecycle state for starts and pickup validation", () => {
    const server = readFileSync("server.js", "utf8");
    expect(server).toMatch(/async function readCanonicalRoomState\(room\)/);
    expect(server).toMatch(/async function writeCanonicalRoomState\(room, state = \{\}, runtime = \{\}\)/);
    expect(server).toMatch(/async function readCanonicalRoomAdmin\(room\)/);
    expect(server).toMatch(/async function setCanonicalRoomAdmin\(room, playerId\)/);
    expect(server).toMatch(/async function startRoomMatch\(room\)/);
    expect(server).toMatch(/const chosen = ENABLE_COHERENCE_BACKEND && cached[\s\S]{0,80}\? cached[\s\S]{0,80}: selectCanonicalRoomState\(local, cached\)/);
    expect(server).toMatch(/updatedAt: Date\.now\(\)/);
    expect(server).toMatch(/const explicitlyEnded =[\s\S]{0,220}\["ENDED", "WAITING"\]\.includes/);
    expect(server).toMatch(/const supersededByNewOwner =[\s\S]{0,220}latest\.ownerServerId !== serverId/);
    expect(server).toMatch(/const timingState = latest\?\.state === "RUNNING" && latestStartTime \? latest : rs;/);
    expect(server).toMatch(/const existing = await readCanonicalRoomState\(room\)/);
    expect(server).toMatch(/const rs = await readCanonicalRoomState\(room\);[\s\S]*error: "not_running"/);
    expect(server).toMatch(/if \(await readCanonicalRoomAdmin\(room\) !== playerIdForSocket\)/);
    expect(server).not.toMatch(/const rs = roomTimers\.get\(room\);[\s\S]{0,140}error: "not_running"/);
    expect(server).toMatch(/socket\.emit\("items\.all", await getItemsForRoom\(wanted\)\);[\s\S]{0,180}socket\.emit\("game\.on"/);
    expect(server).toMatch(/io\.to\(room\)\.emit\("items\.all", await getItemsForRoom\(room\)\);[\s\S]{0,180}io\.to\(room\)\.emit\("game\.on"/);
    expect(server).toMatch(/function listActiveRooms\(info = null\)/);
    expect(server).toMatch(/const profileRoom = profile && profile\.room \? normalizeRoom\(profile\.room\) : null;/);
    expect(server).toMatch(/const profileRoom = info\[id\] && info\[id\]\.room \? normalizeRoom\(info\[id\]\.room\) : null;/);
    expect(server).toMatch(/const rooms = \(roomParam \? \[roomParam\] : listActiveRooms\(info\)\)\.filter\(shouldSyncVisualItems\);/);
    expect(server).toMatch(/const info = await getPlayersInfoObject\(\);\s*const rooms = listActiveRooms\(info\)\.filter\(shouldSyncVisualItems\);/);
  });

  it("hardens room end delivery for load-balanced clients", () => {
    const server = readFileSync("server.js", "utf8");
    expect(server).toMatch(/function buildRoomEndPayload\(room, overrides = \{\}\)/);
    expect(server).toMatch(/remaining: safeRemaining,/);
    expect(server).toMatch(/timeRemaining: safeRemaining,/);
    expect(server).toMatch(/const roomEndRebroadcastTimers = new Map\(\)/);
    expect(server).toMatch(/function getLocalSocketsForRoom\(room\)/);
    expect(server).toMatch(/function emitRoomEndToLocalSockets\(room, endPayload = \{\}\)/);
    expect(server).toMatch(/socket\.emit\("game\.state", "ENDED"\);[\s\S]{0,120}socket\.emit\("game\.end", \{ \.\.\.endPayload, playerId \}\);/);
    expect(server).toMatch(/function scheduleRoomEndRebroadcast\(room, endPayload = \{\}\)/);
    expect(server).toMatch(/const latest = await readCanonicalRoomState\(wanted\);[\s\S]{0,180}latest\?\.state !== "ENDED"/);
    expect(server).toMatch(/emitRoomEndBroadcast\(wanted, endPayload\);/);
    expect(server).toMatch(/if \(state !== "ENDED"\) clearRoomEndRebroadcastTimers\(room\);/);
    expect(server).toMatch(/if \(state === "ENDED"\) \{[\s\S]{0,260}emitRoomEndToLocalSockets\(room, endPayload\);[\s\S]{0,120}scheduleRoomEndRebroadcast\(room, endPayload\);/);
    expect(server).toMatch(/else if \(state === "ENDED"\) \{[\s\S]{0,120}socket\.emit\("game\.end", buildRoomEndPayload\(wanted/);
    expect(server).toMatch(/if \(Number\.isFinite\(Number\(extra\.remaining\)\)\) io\.to\(room\)\.emit\("game\.time", Number\(extra\.remaining\)\);/);
    expect(server).toMatch(/broadcastRoomState\(room, 'ENDED', \{[\s\S]{0,160}remaining: 0/);
  });

  it("enriches gameplay events with canonical room scores before persistence", () => {
    const server = readFileSync("server.js", "utf8");
    expect(server).toMatch(/async function roomScoreForPlayer\(room, playerId/);
    expect(server).toMatch(/async function withCanonicalGameEventScore\(payload = \{\}, \{ room, playerId \} = \{\}\)/);
    expect(server).toMatch(/eventType === "game_over"[\s\S]{0,220}final_score: authoritative\.score/);
    expect(server).toMatch(/const eventPayload = await withCanonicalGameEventScore\(payload, \{/);
    expect(server).toMatch(/const result = await recordGameEvent\(eventPayload, \{/);
    expect(server).toMatch(/type: "powerup_collected"[\s\S]{0,180}score: powerupScore\?\.score/);
  });

  it("builds separated player starts and sends them to clients", () => {
    const server = readFileSync("server.js", "utf8");
    const script = readFileSync("../web/src/script.js", "utf8");
    expect(server).toMatch(/function buildSeparatedStartPositions\(playerIds = \[\], primaryPosition\)/);
    expect(server).toMatch(/const startPositions = buildSeparatedStartPositions\(players, startPosition\)/);
    expect(server).toMatch(/startPositions: rs\.startPositions/);
    expect(script).toMatch(/body && body\.startPositions && typeof body\.startPositions === "object"/);
    expect(script).toMatch(/startPositions && startPositions\[yourId\]/);
  });
});

describe("authoritative boat physics", () => {
  it("soft-clamps server-authoritative boats at visible world boundaries", () => {
    const extents = worldBoundaryExtents({ worldSizeX: 128, worldSizeZ: 42, boatMargin: 1.25 });
    expect(extents.halfX).toBeCloseTo(62.75);
    expect(extents.halfZ).toBeCloseTo(19.75);

    const hit = softClampWorldPosition({
      x: 90,
      z: -30,
      velocity: 3,
      worldSizeX: 128,
      worldSizeZ: 42,
      boatMargin: 1.25,
      speedDamping: 0.35,
    });
    expect(hit.hit).toBe(true);
    expect(hit.edge).toBe("corner");
    expect(hit.x).toBeCloseTo(62.75);
    expect(hit.z).toBeCloseTo(-19.75);
    expect(hit.velocity).toBeCloseTo(1.05);

    const clear = softClampWorldPosition({ x: 10, z: 5, velocity: 2, worldSizeX: 128, worldSizeZ: 42 });
    expect(clear.hit).toBe(false);
    expect(clear.velocity).toBe(2);
  });

  it("uses arcade-scale speed presets instead of runaway production defaults", () => {
    const boatTypes = resolveAuthoritativeBoatTypes();
    expect(boatTypes.speed.maxSpeed).toBeLessThanOrEqual(3);
    expect(boatTypes.fishing.maxSpeed).toBeLessThanOrEqual(2.5);
    expect(boatTypes.rescue.maxSpeed).toBeLessThanOrEqual(3);
    expect(boatTypes.speed.drag).toBeGreaterThanOrEqual(1);
    expect(boatTypes.speed.turnSpeed * boatTypes.speed.handling).toBeGreaterThanOrEqual(0.75);
    expect(boatTypes.fishing.turnSpeed * boatTypes.fishing.handling).toBeGreaterThanOrEqual(0.55);
    expect(boatTypes.rescue.turnSpeed * boatTypes.rescue.handling).toBeGreaterThanOrEqual(0.62);
  });

  it("caps oversized env overrides and falls back when overrides are invalid", () => {
    const boatTypes = resolveAuthoritativeBoatTypes({
      BOAT_SPEED_MAX_SPEED: "100",
      BOAT_FISHING_MAX_SPEED: "bad",
      BOAT_RESCUE_MAX_SPEED: "0",
    });
    expect(boatTypes.speed.maxSpeed).toBe(DEFAULT_SERVER_AUTH_SPEED_LIMIT);
    expect(boatTypes.fishing.maxSpeed).toBe(2.35);
    expect(boatTypes.rescue.maxSpeed).toBe(2.75);
    expect(resolveServerAuthSpeedLimit("")).toBe(DEFAULT_SERVER_AUTH_SPEED_LIMIT);
    expect(resolveServerAuthSpeedLimit("3.75")).toBe(3.75);
  });
});

describe("operator item metrics", () => {
  it("counts local item mirrors for Coherence-backed metrics instead of reporting zero", () => {
    const mapTrash = {};
    const mapMarineLife = {};
    const mapPowerUps = {};

    const options = {
      coherenceEnabled: true,
      mapTrash,
      mapMarineLife,
      mapPowerUps,
      localTrash: { t1: {}, t2: {} },
      localMarineLife: { m1: {} },
      localPowerUps: { p1: {}, p2: {}, p3: {} },
    };

    expect(countMirroredMapEntries(mapTrash, options)).toBe(2);
    expect(countMirroredMapEntries(mapMarineLife, options)).toBe(1);
    expect(countMirroredMapEntries(mapPowerUps, options)).toBe(3);
  });

  it("counts the map directly in memory mode", () => {
    expect(countMirroredMapEntries({ a: {}, b: {} }, { coherenceEnabled: false })).toBe(2);
  });
});

describe("safe item spawning", () => {
  it("keeps spawned items away from active players when a safe candidate exists", () => {
    const coords = [0, 0, 1, 1, 7, 3];
    const position = chooseSpawnPositionAwayFromPlayers({
      players: [{ x: 0, z: 0 }],
      worldSizeX: 88,
      worldSizeZ: 22,
      clearRadius: 4,
      coordinateFactory: () => coords.shift(),
      attempts: 3,
    });

    expect(position).toEqual({ x: 7, y: 0, z: 3 });
  });

  it("uses a deterministic safe fallback when all random candidates are close", () => {
    const coords = [0, 0, 1, 1, 2, 0];
    const position = chooseSpawnPositionAwayFromPlayers({
      players: [{ x: 0, z: 0 }],
      worldSizeX: 12,
      worldSizeZ: 12,
      clearRadius: 4,
      coordinateFactory: () => coords.shift(),
      attempts: 3,
    });

    expect(isPositionWithinRadius2d(position, { x: 0, z: 0 }, 4)).toBe(false);
    expect([{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 0 }])
      .not.toContainEqual({ x: position.x, z: position.z });
  });

  it("keeps required clear positions safe before softer spacing preferences", () => {
    const coords = [0, 0, 1, 1, -1, 1];
    const position = chooseSpawnPositionAwayFromPlayers({
      requiredPlayers: [{ x: 0, z: 0 }],
      players: [
        { x: 0, z: 0 },
        { x: -4, z: -4 },
        { x: -4, z: 4 },
        { x: 4, z: -4 },
        { x: 4, z: 4 },
      ],
      worldSizeX: 10,
      worldSizeZ: 10,
      clearRadius: 4,
      coordinateFactory: () => coords.shift(),
      attempts: 3,
    });

    expect(isPositionWithinRadius2d(position, { x: 0, z: 0 }, 4)).toBe(false);
  });
});

describe("safe opening item relocation", () => {
  it("relocates only items inside the start-position buffer while preserving ids", () => {
    const coords = [10, 0, 12, 1];
    const relocations = buildStartPositionItemRelocations({
      startPosition: { x: 0, z: 0 },
      clearRadius: 6,
      coordinateFactory: () => coords.shift(),
      attempts: 2,
      items: {
        trash_near: { id: "trash_near", type: "trash", position: { x: 2, z: 1 } },
        turtle_safe: { id: "turtle_safe", type: "turtle", position: { x: 20, z: 0 } },
      },
    });

    expect(relocations).toEqual([
      { id: "trash_near", position: { x: 10, y: 0, z: 0 } },
    ]);
    expect(isPositionWithinRadius2d(relocations[0].position, { x: 0, z: 0 }, 6)).toBe(false);
  });

  it("keeps relocated opening items away from each other and existing safe items", () => {
    const coords = [
      15, 0, // rejected: too close to existing safe turtle
      8, 0,  // accepted for first item
      8, 1,  // rejected: too close to first relocation
      -8, 0, // accepted for second item
    ];
    const relocations = buildStartPositionItemRelocations({
      startPosition: { x: 0, z: 0 },
      clearRadius: 6,
      coordinateFactory: () => coords.shift(),
      attempts: 4,
      items: {
        trash_a: { id: "trash_a", type: "trash", position: { x: 1, z: 1 } },
        trash_b: { id: "trash_b", type: "trash", position: { x: -1, z: 1 } },
        turtle_safe: { id: "turtle_safe", type: "turtle", position: { x: 16, z: 0 } },
      },
    });

    expect(relocations.map((entry) => entry.id)).toEqual(["trash_a", "trash_b"]);
    expect(relocations[0].position).toEqual({ x: 8, y: 0, z: 0 });
    expect(relocations[1].position).toEqual({ x: -8, y: 0, z: 0 });
    expect(isPositionWithinRadius2d(relocations[0].position, relocations[1].position, 6)).toBe(false);
    expect(isPositionWithinRadius2d(relocations[0].position, { x: 16, z: 0 }, 6)).toBe(false);
  });

  it("keeps relocated opening items outside the start buffer even when random picks are unsafe", () => {
    const coords = [0, 0, 1, 1, 2, 0];
    const relocations = buildStartPositionItemRelocations({
      startPosition: { x: -3, z: 2 },
      clearRadius: 6,
      worldSizeX: 20,
      worldSizeZ: 14,
      coordinateFactory: () => coords.shift(),
      attempts: 3,
      items: {
        trash_near: { id: "trash_near", type: "trash", position: { x: -6, z: 2 } },
        turtle_safe_a: { id: "turtle_safe_a", type: "turtle", position: { x: 6, z: 6 } },
        turtle_safe_b: { id: "turtle_safe_b", type: "turtle", position: { x: -9, z: -5 } },
      },
    });

    expect(relocations).toHaveLength(1);
    expect(relocations[0].id).toBe("trash_near");
    expect(isPositionWithinRadius2d(relocations[0].position, { x: -3, z: 2 }, 6)).toBe(false);
  });
});

describe("opening collectible seeding", () => {
  it("places demo trash near the start but outside the player safety buffer", () => {
    const positions = buildOpeningCollectiblePositions({
      startPosition: { x: 0, z: 0 },
      count: 3,
      ringRadius: 8,
      clearRadius: 6,
      minSpacing: 3.5,
      worldSizeX: 88,
      worldSizeZ: 22,
    });

    expect(positions).toHaveLength(3);
    for (const position of positions) {
      expect(isPositionWithinRadius2d(position, { x: 0, z: 0 }, 6)).toBe(false);
      expect(Math.hypot(position.x, position.z)).toBeLessThanOrEqual(9);
    }
    expect(isPositionWithinRadius2d(positions[0], positions[1], 3.5)).toBe(false);
    expect(isPositionWithinRadius2d(positions[1], positions[2], 3.5)).toBe(false);
  });

  it("avoids existing opening items and still finds bounded positions near map edges", () => {
    const positions = buildOpeningCollectiblePositions({
      startPosition: { x: 4, z: 4 },
      existingItems: {
        turtle: { position: { x: 4, z: -4 } },
        trash: { position: { x: -4, z: 4 } },
      },
      count: 2,
      ringRadius: 7,
      clearRadius: 5,
      minSpacing: 4,
      worldSizeX: 12,
      worldSizeZ: 12,
    });

    expect(positions).toHaveLength(2);
    for (const position of positions) {
      expect(position.x).toBeGreaterThanOrEqual(-5);
      expect(position.x).toBeLessThanOrEqual(6);
      expect(position.z).toBeGreaterThanOrEqual(-5);
      expect(position.z).toBeLessThanOrEqual(6);
      expect(isPositionWithinRadius2d(position, { x: 4, z: 4 }, 5)).toBe(false);
      expect(isPositionWithinRadius2d(position, { x: 4, z: -4 }, 4)).toBe(false);
      expect(isPositionWithinRadius2d(position, { x: -4, z: 4 }, 4)).toBe(false);
    }
  });
});

describe("player session name profiles", () => {
  it("normalizes display names for server-owned roster state", () => {
    expect(normalizePlayerName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizePlayerName("")).toBe("Player");
  });

  it("updates the current display name without changing the durable player id", () => {
    const first = buildPlayerSessionProfile({}, {
      id: "P1",
      name: "Old URL Name",
      room: "ROOM-1",
      clientSessionId: "CLIENT-1",
    }, "2026-06-15T00:00:00.000Z");
    const updated = buildPlayerSessionProfile(first, {
      id: "P1",
      name: "New Typed Name",
      room: "ROOM-1",
      clientSessionId: "CLIENT-1",
    }, "2026-06-15T00:01:00.000Z");

    expect(updated.id).toBe("P1");
    expect(updated.name).toBe("New Typed Name");
    expect(updated.sessions).toHaveLength(1);
    expect(updated.sessions[0].name).toBe("New Typed Name");
    expect(updated.sessions[0].firstSeenAt).toBe("2026-06-15T00:00:00.000Z");
  });

  it("keeps PAF-trained bot policy metadata in roster session profiles", () => {
    const profile = buildPlayerSessionProfile({}, {
      id: "bot-1",
      name: "Bot Data abc123",
      room: "ROOM-0001",
      clientSessionId: "client:bot-1",
      gameplaySessionId: "BOT:ROOM-0001:bot-1",
      isBot: true,
      teacher: "paf",
      botPolicy: {
        id: "shield-hunter-v1",
        name: "PAF Shield Hunter",
        source: "paf",
        version: "1.0.0",
      },
    }, "2026-06-15T00:02:00.000Z");

    expect(profile.isBot).toBe(true);
    expect(profile.teacher).toBe("paf");
    expect(profile.botPolicy.id).toBe("shield-hunter-v1");
    expect(profile.sessions[0].isBot).toBe(true);
    expect(profile.sessions[0].botPolicy.name).toBe("PAF Shield Hunter");
  });

  it("keeps bounded per-player session history across rooms and gameplay sessions", () => {
    let profile = {};
    for (let i = 0; i < MAX_PLAYER_SESSION_HISTORY + 3; i += 1) {
      profile = buildPlayerSessionProfile(profile, {
        id: "P2",
        name: `Player ${i}`,
        room: `ROOM-${i}`,
        clientSessionId: "CLIENT-2",
        gameplaySessionId: `GAME-${i}`,
      }, `2026-06-15T00:${String(i).padStart(2, "0")}:00.000Z`);
    }
    expect(profile.sessions).toHaveLength(MAX_PLAYER_SESSION_HISTORY);
    expect(profile.sessions[0].room).toBe("ROOM-3");
    expect(profile.sessions.at(-1).name).toBe(`Player ${MAX_PLAYER_SESSION_HISTORY + 2}`);
  });
});
