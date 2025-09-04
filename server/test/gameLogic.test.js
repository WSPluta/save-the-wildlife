import { describe, it, expect } from "vitest";
import {
  clampNum,
  fib,
  normalizeRoom,
  computeTargets,
  recomputeWorldSize,
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
