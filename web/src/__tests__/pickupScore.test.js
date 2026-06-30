import { describe, expect, it } from "vitest";
import {
  beginOptimisticPickupScore,
  pickupScoreDelta,
  reconcilePickupScore,
  rollbackOptimisticPickupScore,
} from "../pickupScore.js";

describe("pickup score reconciliation", () => {
  it("updates trash and turtle scores immediately without changing powerup score", () => {
    expect(pickupScoreDelta("trash")).toBe(1);
    expect(pickupScoreDelta("turtle")).toBe(-1);
    expect(pickupScoreDelta("turtle", { shielded: true })).toBe(0);
    expect(pickupScoreDelta("powerup_speed")).toBe(0);
  });

  it("does not double-apply an accepted optimistic pickup", () => {
    const optimistic = beginOptimisticPickupScore(4, "trash");
    expect(optimistic).toEqual({ score: 5, delta: 1, applied: true });
    expect(reconcilePickupScore({
      currentScore: optimistic.score,
      pending: { optimisticApplied: true, optimisticDelta: 1 },
      payload: { ok: true, scoreDelta: 1 },
      itemType: "trash",
    })).toBe(5);
  });

  it("lets the authoritative server total correct the provisional display", () => {
    expect(reconcilePickupScore({
      currentScore: 5,
      pending: { optimisticApplied: true, optimisticDelta: 1 },
      payload: { ok: true, score: 8, serverScore: 8, scoreDelta: 1 },
      itemType: "trash",
      pendingScoreDelta: 1,
    })).toBe(9);
  });

  it("adjusts a provisional penalty when the server confirms a shielded hit", () => {
    expect(reconcilePickupScore({
      currentScore: -1,
      pending: { optimisticApplied: true, optimisticDelta: -1 },
      payload: { ok: true, scoreDelta: 0 },
      itemType: "turtle",
    })).toBe(0);
  });

  it("rolls back rejected, timed-out, or rival-owned provisional pickups", () => {
    expect(rollbackOptimisticPickupScore(5, {
      optimisticApplied: true,
      optimisticDelta: 1,
    })).toBe(4);
    expect(rollbackOptimisticPickupScore(-1, {
      optimisticApplied: true,
      optimisticDelta: -1,
    })).toBe(0);
  });
});
