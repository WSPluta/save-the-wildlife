import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  __resetGameEventsForTests,
  __setOracleConnectionForTests,
  buildCommentary,
  deterministicCommentary,
  normalizeGameEvent,
  recordGameEvent,
  recordPlayerSessionProfile,
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

  it("keeps missing scores unknown instead of coercing them to zero", () => {
    const collected = normalizeGameEvent({
      type: "powerup_collected",
      sessionId: "S-SCORE-GAP",
      roomId: "ROOM-1",
      playerId: "P1",
      score: null,
    });
    const ended = normalizeGameEvent({
      type: "game_over",
      sessionId: "S-SCORE-GAP",
      roomId: "ROOM-1",
      playerId: "P1",
      score: null,
    });

    expect(collected.score).toBeNull();
    expect(ended.score).toBeNull();
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

  it("persists canonical player session profiles for name/session source of truth", async () => {
    const calls = [];
    __setOracleConnectionForTests({
      async execute(sql, binds, options) {
        calls.push({ sql, binds, options });
        return {};
      },
    });

    const result = await recordPlayerSessionProfile({
      id: "P-NAME",
      name: "Fresh Name",
      room: "ROOM-NAME",
      clientSessionId: "CLIENT-1",
      gameplaySessionId: "GAME-1",
      updatedAt: "2026-06-15T00:00:00.000Z",
      sessions: [{ sessionKey: "CLIENT-1:GAME-1:ROOM-NAME", name: "Fresh Name" }],
    });

    expect(result.persisted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/MERGE INTO stwl_player_sessions/i);
    expect(calls[0].options).toEqual({ autoCommit: true });
    expect(calls[0].binds).toMatchObject({
      player_id: "P-NAME",
      player_name: "Fresh Name",
      room_id: "ROOM-NAME",
      client_session_id: "CLIENT-1",
      gameplay_session_id: "GAME-1",
    });
    expect(JSON.parse(calls[0].binds.sessions_json)).toHaveLength(1);
  });

  it("ships a sequence-backed Oracle telemetry schema for live ADB compatibility", () => {
    const ddl = readFileSync(new URL("../../deploy/db/stwl_game_events.sql", import.meta.url), "utf8");
    const runtime = readFileSync(new URL("../lib/gameEvents.js", import.meta.url), "utf8");

    expect(ddl).toMatch(/CREATE\s+SEQUENCE\s+stwl_game_events_seq/i);
    expect(ddl).toMatch(/event_type\s+IN\s*\(/i);
    expect(ddl).toMatch(/powerup_collected/i);
    expect(ddl).toMatch(/trail_crossed/i);
    expect(ddl).toMatch(/player_frozen/i);
    expect(ddl).toMatch(/metadata_json\s+CLOB\s+CHECK\s*\(\s*metadata_json\s+IS\s+JSON\s*\)/i);
    expect(ddl).toMatch(/CREATE\s+TABLE\s+stwl_player_sessions/i);
    expect(ddl).toMatch(/sessions_json\s+CLOB\s+CHECK\s*\(\s*sessions_json\s+IS\s+JSON\s*\)/i);
    expect(ddl).toMatch(/score_source'\), JSON_VALUE\(metadata_json, '\$\.scoreSource'\)\) = 'server_room_state'/i);
    expect(ddl).toMatch(/event_type <> 'game_over' AND score IS NOT NULL/i);
    expect(ddl).toMatch(/CREATE OR REPLACE TRIGGER stwl_game_events_score_guard/i);
    expect(ddl).toMatch(/BEFORE INSERT ON stwl_game_events/i);
    expect(ddl).toMatch(/NVL\(v_score_source, 'client'\) <> 'server_room_state'/i);
    expect(ddl).toMatch(/COMMENT ON TABLE stwl_session_summary/i);
    expect(ddl).not.toMatch(/COMMENT ON VIEW stwl_session_summary/i);
    expect(runtime).toMatch(/score: finiteNumber\(rawScore, null\)/);
    expect(runtime).toMatch(/CREATE OR REPLACE TRIGGER stwl_game_events_score_guard/i);
    expect(runtime).toMatch(/COMMENT ON TABLE stwl_session_summary/i);
    const playerSessionDdl = runtime.match(/CREATE TABLE stwl_player_sessions \(([\s\S]*?)\)`;/)?.[1] || "";
    expect(playerSessionDdl.match(/\broom_id\s+VARCHAR2\(64\)/gi)).toHaveLength(1);
  });

  it("uses terminal game_over final score as commentary source of truth", async () => {
    const sessionId = `S-FINAL-${Date.now()}-${Math.random()}`;
    await recordGameEvent({ type: "game_started", sessionId, roomId: "ROOM-FINAL", playerId: "P-FINAL", playerName: "Finalist", score: 0 });
    await recordGameEvent({ type: "trash_collected", sessionId, roomId: "ROOM-FINAL", playerId: "P-FINAL", score: 4 });
    await recordGameEvent({ type: "position_sample", sessionId, roomId: "ROOM-FINAL", playerId: "P-FINAL", score: 99 });
    await recordGameEvent({
      type: "game_over",
      sessionId,
      roomId: "ROOM-FINAL",
      playerId: "P-FINAL",
      score: 4,
      finalScore: 14,
      metadata: { final_score: 14 },
    });
    await recordGameEvent({ type: "powerup_collected", sessionId, roomId: "ROOM-FINAL", playerId: "P-FINAL", score: 99, powerupType: "powerup_speed" });

    const event = normalizeGameEvent({
      type: "game_over",
      sessionId: "S-RAW",
      roomId: "ROOM-FINAL",
      playerId: "P-FINAL",
      score: 4,
      final_score: 14,
    });
    expect(event.score).toBe(14);
    expect(summarizeSession(sessionId, "P-FINAL").score).toBe(14);
    expect((await buildCommentary(sessionId, "P-FINAL")).summary.score).toBe(14);
  });

  it("does not let a scoreless game_over erase the latest recorded score", async () => {
    const sessionId = `S-MISSING-FINAL-${Date.now()}-${Math.random()}`;
    await recordGameEvent({ type: "game_started", sessionId, roomId: "ROOM-FINAL", playerId: "P-GAP", playerName: "Gap" });
    await recordGameEvent({ type: "trash_collected", sessionId, roomId: "ROOM-FINAL", playerId: "P-GAP", score: 3 });
    await recordGameEvent({ type: "game_over", sessionId, roomId: "ROOM-FINAL", playerId: "P-GAP", score: null });

    expect(summarizeSession(sessionId, "P-GAP").score).toBe(3);
    expect((await buildCommentary(sessionId, "P-GAP")).summary.score).toBe(3);
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
    expect(text).toMatch(/Trail pressure|12/);

    const response = await buildCommentary(sessionId, "P2");
    expect(response.commentary.length).toBeLessThanOrEqual(200);
    expect(response.summary.freezes).toBe(1);
  });

  it("keeps score-zero fallback commentary stage-safe", () => {
    const text = deterministicCommentary({
      score: 0,
      trash_collected: 0,
      marine_hits: 0,
      trail_crosses: 7,
      freezes: 7,
      powerups: {},
      prior_best_score: null,
    });

    expect(text).toBe("Freeze-heavy run: 7 freeze event(s) after 7 trail crossing(s), no score yet. Needs a cleaner lane.");
    expect(text).not.toMatch(/still finished with 0|stubborn navigation/i);
    expect(text.length).toBeLessThanOrEqual(200);
  });

  it("does not call a zero score a personal best", () => {
    const text = deterministicCommentary({
      score: 0,
      trash_collected: 0,
      marine_hits: 0,
      trail_crosses: 0,
      freezes: 0,
      powerups: {},
      prior_best_score: 0,
    });

    expect(text).toBe("No score yet. The next clean pickup is the moment to watch.");
    expect(text).not.toMatch(/personal best/i);
  });

  it("reads PAF commentary config at request time", async () => {
    const previousBaseUrl = process.env.PAF_AGENT_BASE_URL;
    const previousTimeoutMs = process.env.PAF_AGENT_TIMEOUT_MS;
    const server = createServer((req, res) => {
      expect(req.url).toBe("/api/commentary");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        commentary: "Oracle path commentary.",
        source: "oci-base",
        trace_id: "TRACE-SERVER",
        route_mode: "shadow",
        primary_provider: "oci-base",
        candidate_provider: "oci-fine-tuned",
        model_id: "stwl-base-v1",
        latency_ms: 104,
        evidence_hash: "abc123",
        prompt_hash: "def456",
        promotion_verdict: "candidate_ready",
        eval_scores: {
          verdict: "candidate_ready",
          candidate: { uses_retrieved_evidence: true },
        },
        model_route: {
          trace_id: "TRACE-SERVER",
          primary: { provider: "oci-base", model_id: "stwl-base-v1" },
          candidate: { provider: "oci-fine-tuned", model_id: "stwl-ft-v1" },
        },
      }));
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    process.env.PAF_AGENT_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.PAF_AGENT_TIMEOUT_MS = "1000";

    try {
      const sessionId = `S-PAF-${Date.now()}-${Math.random()}`;
      await recordGameEvent({ type: "game_over", sessionId, roomId: "ROOM-PAF", playerId: "P-PAF", score: 44 });
      const response = await buildCommentary(sessionId, "P-PAF");
      expect(response.source).toBe("oci-base");
      expect(response.commentary).toBe("Oracle path commentary.");
      expect(response.trace_id).toBe("TRACE-SERVER");
      expect(response.model_route.candidate.model_id).toBe("stwl-ft-v1");
      expect(response.eval_scores.verdict).toBe("candidate_ready");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (previousBaseUrl == null) delete process.env.PAF_AGENT_BASE_URL;
      else process.env.PAF_AGENT_BASE_URL = previousBaseUrl;
      if (previousTimeoutMs == null) delete process.env.PAF_AGENT_TIMEOUT_MS;
      else process.env.PAF_AGENT_TIMEOUT_MS = previousTimeoutMs;
    }
  });
});
