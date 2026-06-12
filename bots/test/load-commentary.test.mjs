import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoomName,
  buildTelemetryEvents,
  deriveServiceBaseUrl,
  deriveSocketTarget,
  evaluateTierGates,
  findDuplicateCommentary,
  loadConfig,
  normalizeCommentaryText,
  parseTiers,
  percentile,
  planTier,
} from "../load-commentary.mjs";

test("parses tier lists and falls back to the production sequence", () => {
  assert.deepEqual(parseTiers(""), [5, 10, 50, 100, 500, 1000]);
  assert.deepEqual(parseTiers("5,10,10,50"), [5, 10, 50]);
  assert.throws(() => parseTiers("5,nope"), /invalid_load_tier/);
});

test("derives Socket.IO origin and path from public URLs", () => {
  assert.deepEqual(
    deriveSocketTarget({ baseUrl: "https://example.test" }),
    { url: "https://example.test", path: "/socket.io" }
  );
  assert.deepEqual(
    deriveSocketTarget({ wsUrl: "wss://example.test/socket.io" }),
    { url: "https://example.test", path: "/socket.io" }
  );
  assert.equal(deriveServiceBaseUrl("wss://example.test/socket.io"), "https://example.test");
  assert.equal(deriveServiceBaseUrl("https://example.test/api"), "https://example.test");
});

test("plans tier ramping with stable short room names", () => {
  const config = loadConfig({
    STWL_LOAD_RUN_ID: "202606121234",
    STWL_LOAD_TIERS: "1000",
    STWL_LOAD_WS_URL: "https://stwl.example.test",
    STWL_LOAD_CAPTURE_K8S: "false",
  });
  const tierPlan = planTier(1000, config);

  assert.equal(tierPlan.tier, 1000);
  assert.equal(tierPlan.room, "LOAD-202606121234-1000");
  assert.equal(tierPlan.rampPerSecond, 75);
  assert.ok(tierPlan.commentaryConcurrency > 0);
  assert.ok(buildRoomName("THIS-RUN-ID-IS-TOO-LONG-FOR-SERVER", 1000).length <= 24);
});

test("normalizes and detects duplicate commentary text", () => {
  const players = [
    { id: "a", commentary: { text: " Great run. " } },
    { id: "b", commentary: { text: "great   run." } },
    { id: "c", commentary: { text: "Different finish." } },
  ];

  assert.equal(normalizeCommentaryText("  SQL   Saw It "), "sql saw it");
  assert.deepEqual(findDuplicateCommentary(players), [
    { text: "great run.", count: 2, playerIds: ["a", "b"] },
  ]);
});

test("computes percentile from sparse commentary latencies", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
});

test("fails strict gates for duplicates, missing commentary, fallback source, and latency", () => {
  const report = {
    attempted: 3,
    players: [
      {
        id: "p1",
        joined: true,
        scoreRow: { ok: true },
        commentary: { text: "Same line", source: "oracle-private-agent-factory", latencyMs: 100 },
      },
      {
        id: "p2",
        joined: true,
        scoreRow: { ok: true },
        commentary: { text: "Same line", source: "deterministic-fallback", latencyMs: 12_001 },
      },
      { id: "p3", joined: true, scoreRow: { ok: true }, commentary: null },
    ],
  };

  const gates = evaluateTierGates(report, {
    commentaryTimeoutMs: 10_000,
    joinFailureThreshold: 0.01,
    requireFullPath: true,
    disallowedSources: ["deterministic-fallback"],
  });

  assert.equal(gates.verdict, "failed");
  assert.ok(gates.reasons.some((reason) => reason.startsWith("missing_commentary")));
  assert.ok(gates.reasons.some((reason) => reason.startsWith("duplicate_commentary")));
  assert.ok(gates.reasons.some((reason) => reason.startsWith("commentary_p95_above_threshold")));
  assert.ok(gates.reasons.some((reason) => reason.startsWith("commentary_source_not_full_path")));
});

test("passes strict gates for unique full-path commentary", () => {
  const report = {
    attempted: 2,
    players: [
      {
        id: "p1",
        joined: true,
        scoreRow: { ok: true },
        commentary: { text: "Ada finished on 42.", source: "oracle-private-agent-factory", latencyMs: 900 },
      },
      {
        id: "p2",
        joined: true,
        scoreRow: { ok: true },
        commentary: { text: "Grace closed at 43.", source: "oracle-private-agent-factory", latencyMs: 1100 },
      },
    ],
  };

  const gates = evaluateTierGates(report, {
    commentaryTimeoutMs: 10_000,
    joinFailureThreshold: 0.01,
    requireFullPath: true,
    disallowedSources: ["deterministic-fallback"],
  });

  assert.equal(gates.verdict, "passed");
  assert.equal(gates.commentaryReceived, 2);
  assert.equal(gates.scoreRows.verified, 2);
  assert.equal(gates.latency.p95, 1100);
});

test("fails strict gates when joined players do not have verified high-score rows", () => {
  const report = {
    attempted: 2,
    players: [
      {
        id: "p1",
        joined: true,
        scoreRow: { ok: true },
        commentary: { text: "Ada finished on 42.", source: "oracle-private-agent-factory", latencyMs: 900 },
      },
      {
        id: "p2",
        joined: true,
        scoreRow: { ok: false, error: "http_404" },
        commentary: { text: "Grace closed at 43.", source: "oracle-private-agent-factory", latencyMs: 1100 },
      },
    ],
  };

  const gates = evaluateTierGates(report, {
    commentaryTimeoutMs: 10_000,
    joinFailureThreshold: 0.01,
    requireFullPath: true,
    requireScoreRows: true,
    disallowedSources: ["deterministic-fallback"],
  });

  assert.equal(gates.verdict, "failed");
  assert.deepEqual(gates.scoreRows.missing, ["p2"]);
  assert.ok(gates.reasons.includes("missing_high_score_rows:1"));
});

test("join-failure aborts do not also require commentary", () => {
  const report = {
    attempted: 100,
    commentaryAttempted: false,
    players: Array.from({ length: 95 }, (_, index) => ({
      id: `p${index}`,
      joined: true,
      commentary: null,
    })),
    scoreAttempted: false,
  };

  const gates = evaluateTierGates(report, {
    commentaryTimeoutMs: 10_000,
    joinFailureThreshold: 0.01,
    requireFullPath: true,
    disallowedSources: ["deterministic-fallback"],
  });

  assert.equal(gates.verdict, "failed");
  assert.deepEqual(gates.reasons, ["join_failures_above_threshold:5/100"]);
  assert.equal(gates.commentaryReceived, 0);
  assert.equal(gates.scoreRows.required, false);
});

test("builds varied per-player telemetry ending in game_over", () => {
  const events = buildTelemetryEvents({
    id: "p1",
    name: "Load Player",
    index: 1,
    tier: 50,
    room: "LOAD-ROOM",
    sessionId: "LOAD-ROOM:p1",
  });

  assert.equal(events[0].type, "game_started");
  assert.equal(events.at(-1).type, "game_over");
  assert.equal(events.at(-1).playerName, "Load Player");
  assert.ok(events.some((event) => event.type === "trail_crossed" || event.type === "player_frozen"));
});
