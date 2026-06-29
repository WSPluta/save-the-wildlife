import { describe, expect, it } from "vitest";
import {
  authoritativeFinalScoreFromEndPayload,
  endPayloadHasAuthoritativeScores,
  finalScoreFromSources,
  scoreMapValueForPlayer,
} from "../scoreIntegrity.js";

describe("score integrity", () => {
  it("does not let an unmarked stale zero end payload override the accepted local score", () => {
    expect(finalScoreFromSources({
      playerId: "P1",
      localScore: 7,
      endPayload: {
        playerId: "P1",
        score: 0,
        scores: { P1: 0 },
      },
    })).toBe(7);
  });

  it("uses server room-state scores when the end payload marks them authoritative", () => {
    const endPayload = {
      authoritativeScores: true,
      finalScores: { P1: 12, P2: -2 },
    };
    expect(endPayloadHasAuthoritativeScores(endPayload)).toBe(true);
    expect(authoritativeFinalScoreFromEndPayload(endPayload, "P1")).toBe(12);
    expect(finalScoreFromSources({ playerId: "P1", localScore: 7, endPayload })).toBe(12);
  });

  it("preserves negative scores from accepted turtle hits", () => {
    expect(finalScoreFromSources({
      playerId: "P2",
      localScore: -2,
      endPayload: {},
    })).toBe(-2);
  });

  it("reads only finite per-player score map values", () => {
    expect(scoreMapValueForPlayer({ P1: "5", P2: "bad" }, "P1")).toBe(5);
    expect(scoreMapValueForPlayer({ P1: "5", P2: "bad" }, "P2")).toBeNull();
    expect(scoreMapValueForPlayer(null, "P1")).toBeNull();
  });
});
