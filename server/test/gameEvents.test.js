import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  __resetGameEventsForTests,
  __setOracleConnectionForTests,
  buildCommentary,
  deterministicCommentary,
  normalizeGameEvent,
  recordGameEvent,
  summarizeSession,
} from "../lib/gameEvents.js";

describe("game event telemetry", () => {
  beforeEach(() => {
    __resetGameEventsForTests();
  });

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

  it("captures trail crossing and freeze events with coordinates and related players", () => {
    const trailEvent = normalizeGameEvent({
      type: "trail_crossed",
      sessionId: "S-TRAIL",
      roomId: "ROOM-1",
      playerId: "P1",
      relatedPlayerId: "P2",
      score: 18,
      x: 4.5,
      y: 0,
      z: -9.25,
      metadata: { trail_segment_id: "seg-7" },
    });
    const freezeEvent = normalizeGameEvent({
      type: "player_frozen",
      sessionId: "S-TRAIL",
      roomId: "ROOM-1",
      playerId: "P1",
      relatedPlayerId: "P2",
      freezeMs: 2500,
      position: { x: 4.5, y: 0, z: -9.25 },
    });

    expect(trailEvent.event_type).toBe("trail_crossed");
    expect(trailEvent.related_player_id).toBe("P2");
    expect(trailEvent.x).toBe(4.5);
    expect(trailEvent.z).toBe(-9.25);
    expect(trailEvent.metadata.trail_segment_id).toBe("seg-7");
    expect(freezeEvent.event_type).toBe("player_frozen");
    expect(freezeEvent.related_player_id).toBe("P2");
    expect(freezeEvent.metadata.freeze_ms).toBe(2500);
    expect(freezeEvent.x).toBe(4.5);
  });

  it("persists Oracle rows with coordinates, related ids, score, and JSON metadata", async () => {
    const calls = [];
    __setOracleConnectionForTests({
      async execute(sql, binds, options) {
        calls.push({ sql, binds, options });
        return {};
      },
    });

    const result = await recordGameEvent({
      type: "powerup_collected",
      sessionId: "S-DB",
      roomId: "ROOM-DB",
      playerId: "P-DB",
      playerName: "Lin",
      score: 33,
      position: { x: 7.5, y: 0, z: -3.25 },
      relatedPlayerId: "P-RIVAL",
      itemId: "PU-1",
      powerupType: "powerup_shield",
      metadata: { collision_id: "hit-9" },
    });

    expect(result.persisted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO stwl_game_events/i);
    expect(calls[0].sql).toMatch(/stwl_game_events_seq\.NEXTVAL/i);
    expect(calls[0].options).toEqual({ autoCommit: true });
    expect(calls[0].binds).toMatchObject({
      session_id: "S-DB",
      room_id: "ROOM-DB",
      player_id: "P-DB",
      player_name: "Lin",
      event_type: "powerup_collected",
      score: 33,
      x: 7.5,
      y: 0,
      z: -3.25,
      related_player_id: "P-RIVAL",
      related_item_id: "PU-1",
    });
    expect(JSON.parse(calls[0].binds.metadata_json)).toEqual({
      collision_id: "hit-9",
      powerup_type: "powerup_shield",
    });
  });

  it("ships a sequence-backed Oracle telemetry schema for live ADB compatibility", () => {
    const ddl = readFileSync(new URL("../../deploy/db/stwl_game_events.sql", import.meta.url), "utf8");

    expect(ddl).toMatch(/CREATE\s+SEQUENCE\s+stwl_game_events_seq/i);
    expect(ddl).toMatch(/event_type\s+IN\s*\(/i);
    expect(ddl).toMatch(/powerup_collected/i);
    expect(ddl).toMatch(/trail_crossed/i);
    expect(ddl).toMatch(/player_frozen/i);
    expect(ddl).toMatch(/metadata_json\s+CLOB\s+CHECK\s*\(\s*metadata_json\s+IS\s+JSON\s*\)/i);
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
    expect(summary.player_name).toBe("Grace");

    const text = deterministicCommentary(summary);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).toMatch(/Frozen|12/);

    const response = await buildCommentary(sessionId, "P2");
    expect(response.commentary.length).toBeLessThanOrEqual(200);
    expect(response.summary.freezes).toBe(1);
  });
});
