import { describe, expect, it } from "vitest";
import {
  buildCommentary,
  deterministicCommentary,
  normalizeGameEvent,
  recordGameEvent,
  summarizeSession,
} from "../lib/gameEvents.js";

describe("game event telemetry", () => {
  it("normalizes supported gameplay events with coordinates and metadata", () => {
    const event = normalizeGameEvent({
      type: "powerup_collected",
      sessionId: "S1",
      roomId: "ROOM-1",
      playerId: "P1",
      playerName: "Ada",
      score: 7,
      position: { x: 1.25, y: 0, z: -2.5 },
      itemId: "I1",
      powerupType: "powerup_freeze",
    });

    expect(event.event_type).toBe("powerup_collected");
    expect(event.session_id).toBe("S1");
    expect(event.player_id).toBe("P1");
    expect(event.x).toBe(1.25);
    expect(event.z).toBe(-2.5);
    expect(event.related_item_id).toBe("I1");
    expect(event.metadata.powerup_type).toBe("powerup_freeze");
  });

  it("rejects unsupported event types", () => {
    expect(() => normalizeGameEvent({ type: "made_up", playerId: "P1" })).toThrow(/unsupported_event_type/);
  });

  it("summarizes powerups, freezes, and game over events for commentary", async () => {
    const sessionId = `S-${Date.now()}-${Math.random()}`;
    await recordGameEvent({ type: "game_started", sessionId, roomId: "ROOM-1", playerId: "P2", playerName: "Grace" });
    await recordGameEvent({ type: "powerup_collected", sessionId, roomId: "ROOM-1", playerId: "P2", powerupType: "powerup_magnet" });
    await recordGameEvent({ type: "trail_crossed", sessionId, roomId: "ROOM-1", playerId: "P2", relatedPlayerId: "P3" });
    await recordGameEvent({ type: "player_frozen", sessionId, roomId: "ROOM-1", playerId: "P2", relatedPlayerId: "P3" });
    await recordGameEvent({ type: "game_over", sessionId, roomId: "ROOM-1", playerId: "P2", score: 12 });

    const summary = summarizeSession(sessionId, "P2");
    expect(summary.powerups.powerup_magnet).toBe(1);
    expect(summary.trail_crosses).toBe(1);
    expect(summary.freezes).toBe(1);
    expect(summary.score).toBe(12);

    const text = deterministicCommentary(summary);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).toMatch(/Frozen|12/);

    const response = await buildCommentary(sessionId, "P2");
    expect(response.commentary.length).toBeLessThanOrEqual(200);
    expect(response.summary.freezes).toBe(1);
  });
});
