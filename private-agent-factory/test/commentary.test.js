import assert from "node:assert/strict";
import test from "node:test";

process.env.PAF_DISABLE_SERVER = "1";

const {
  buildCanvasMessage,
  buildCommentary,
  callPafCanvas,
  extractCanvasText,
  normalizeSummary,
} = await import("../index.js");

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("builds a Canvas prompt from recorded SQL gameplay telemetry", () => {
  const summary = normalizeSummary({
    session_id: "S1",
    player_id: "P1",
    player_name: "Ada",
    score: 42,
    trash_collected: 7,
    trail_crosses: 1,
    freezes: 1,
    powerups: { powerup_shield: 1 },
    last_position: { x: 12.25, y: 0, z: -4.5 },
    prior_best_score: 39,
  });

  const message = buildCanvasMessage(summary);
  assert.match(message, /SQL gameplay telemetry/);
  assert.match(message, /powerup_shield:1/);
  assert.match(message, /trail_crosses=1/);
  assert.match(message, /freezes=1/);
  assert.match(message, /coords=\(12\.3,0\.0,-4\.5\)/);
  assert.match(message, /prior_best=39/);
});

test("extracts text from common PAF Canvas response shapes", () => {
  assert.equal(extractCanvasText({ payload: { message: "Canvas line" } }), "Canvas line");
  assert.equal(extractCanvasText({ message: { content: [{ text: "Nested line" }] } }), "Nested line");
  assert.equal(extractCanvasText({ choices: [{ message: { content: "Choice line" } }] }), "Choice line");
});

test("uses a configured PAF Canvas endpoint before deterministic fallback", async () => {
  const seen = [];
  const endpoint = "https://paf.example.test:8080/agentFactory/v1/agentBuilder/run/STWL";
  const requestJson = async (url, options) => {
    seen.push({ url, body: JSON.parse(options.body || "{}") });
    return {
      status: 200,
      headers: {},
      elapsed_ms: 12,
      payload: {
        roomId: "ROOM-CANVAS",
        message: "Shield grab, trail freeze, 42 points. SQL saw the move.",
      },
    };
  };

  await withEnv({
    ORACLE_USER: "",
    ORACLE_PASSWORD: "",
    ORACLE_CONNECT_STRING: "",
    PAF_CANVAS_RUN_ENDPOINT_URL: endpoint,
    PAF_CANVAS_ROOM_ID: "",
    PAF_CANVAS_TIMEOUT_MS: "1000",
    PAF_CANVAS_VERIFY_TLS: "false",
    PAF_CANVAS_SESSION_COOKIE: "",
    PAF_SESSION_COOKIE: "",
    PAF_COOKIE: "",
    PAF_CANVAS_BASIC_USERNAME: "",
    PAF_CANVAS_BASIC_PASSWORD: "",
    PAF_BASIC_USERNAME: "",
    PAF_BASIC_PASSWORD: "",
  }, async () => {
    const summary = normalizeSummary({
      session_id: "S2",
      player_id: "P2",
      player_name: "Grace",
      score: 42,
      trail_crosses: 1,
      freezes: 1,
      powerups: { powerup_shield: 1 },
    });

    const canvas = await callPafCanvas(summary, 200, { requestJson });
    assert.equal(canvas.commentary, "Shield grab, trail freeze, 42 points. SQL saw the move.");
    assert.equal(canvas.room_id, "ROOM-CANVAS");

    const response = await buildCommentary({ summary }, { requestJson });
    assert.equal(response.source, "paf-canvas");
    assert.equal(response.commentary, "Shield grab, trail freeze, 42 points. SQL saw the move.");
    assert.equal(response.canvas.room_id, "ROOM-CANVAS");
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, endpoint);
  assert.match(seen[0].body.message, /trail_crosses=1/);
  assert.match(seen[0].body.message, /freezes=1/);
  assert.equal(seen[0].body.roomId, null);
});
