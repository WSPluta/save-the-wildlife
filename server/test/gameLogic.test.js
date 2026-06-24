import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  clampNum,
  DEFAULT_COLLISION_VALIDATE_RADIUS,
  DEFAULT_SERVER_AUTH_SPEED_LIMIT,
  MAX_PLAYER_SESSION_HISTORY,
  buildPlayerSessionProfile,
  fib,
  normalizeRoom,
  resolveJoiningRoom,
  normalizePlayerName,
  computeTargets,
  recomputeWorldSize,
  resolveAuthoritativeBoatTypes,
  resolveCollisionValidateRadius,
  resolveServerAuthSpeedLimit,
  countMirroredMapEntries,
  chooseSpawnPositionAwayFromPlayers,
  buildStartPositionItemRelocations,
  buildOpeningCollectiblePositions,
  isPositionWithinRadius2d,
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
  it("defaults to an arcade pickup radius that matches the visible client hitbox", () => {
    expect(DEFAULT_COLLISION_VALIDATE_RADIUS).toBe(6.5);
    expect(resolveCollisionValidateRadius()).toBe(6.5);
  });

  it("accepts explicit positive overrides and ignores invalid values", () => {
    expect(resolveCollisionValidateRadius("2.25")).toBe(2.25);
    expect(resolveCollisionValidateRadius("0")).toBe(6.5);
    expect(resolveCollisionValidateRadius("bad")).toBe(6.5);
  });
});

describe("production collision configuration", () => {
  it("keeps the OKE ws-server pickup radius aligned with the server default", () => {
    const template = readFileSync("../deploy/k8s/base/ws-server/env_server_template", "utf8");
    expect(template).toContain(`COLLISION_VALIDATE_RADIUS=${DEFAULT_COLLISION_VALIDATE_RADIUS}`);
  });
});

describe("authoritative multiplayer lifecycle", () => {
  it("initializes player state on game.start before the room reaches RUNNING", () => {
    const server = readFileSync("server.js", "utf8");
    expect(server).toMatch(/socket\.on\("game\.start"/);
    expect(server).toMatch(/if \(SERVER_AUTH_ENABLED && !playersState\.has\(playerId\)\)/);
    expect(server).not.toMatch(/SERVER_AUTH_ENABLED && matchRunning && !playersState\.has\(playerId\)/);
  });
});

describe("authoritative boat physics", () => {
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
