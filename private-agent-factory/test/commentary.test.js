import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.PAF_DISABLE_SERVER = "1";

const {
  buildCanvasMessage,
  buildCommentary,
  callInDbAgent,
  callPafCanvas,
  extractCanvasText,
  normalizeSummary,
  selectAiInitStatements,
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

  const withDraft = buildCanvasMessage(summary, {
    inDbCommentary: "Select AI draft: shield, freeze, and 42 points.",
  });
  assert.match(withDraft, /oracle_ai_database_draft=Select AI draft/);
});

test("extracts text from common PAF Canvas response shapes", () => {
  assert.equal(extractCanvasText({ payload: { message: "Canvas line" } }), "Canvas line");
  assert.equal(extractCanvasText({ message: { content: [{ text: "Nested line" }] } }), "Nested line");
  assert.equal(extractCanvasText({ choices: [{ message: { content: "Choice line" } }] }), "Choice line");
});

test("uses Oracle AI Database in-db agent package when configured", async () => {
  const executeCalls = [];
  const oracleConnection = {
    async execute(sql, binds) {
      executeCalls.push({ sql, binds });
      return {
        outBinds: {
          result: JSON.stringify({
            ok: 1,
            source: "select-ai",
            commentary: "Select AI saw a freeze powerup and 77 points.",
            summary: {
              session_id: "S-INDB",
              player_id: "P-INDB",
              player_name: "Ada",
              score: 77,
              freezes: 1,
              trail_crosses: 1,
              powerups: { powerup_freeze: 1 },
            },
          }),
        },
      };
    },
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    SELECT_AI_PROFILE: "STWL_GAMEPLAY_AI",
    SELECT_AI_AGENT_TEAM: "STWL_GAMEPLAY_COMMENTARY_TEAM",
  }, async () => {
    const result = await callInDbAgent(
      normalizeSummary({ session_id: "S-INDB", player_id: "P-INDB", score: 77 }),
      200,
      {
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
      }
    );

    assert.equal(result.source, "select-ai");
    assert.equal(result.commentary, "Select AI saw a freeze powerup and 77 points.");
    assert.equal(result.summary.score, 77);
  });

  assert.equal(executeCalls.length, 1);
  assert.match(executeCalls[0].sql, /STWL_COMMENTARY_PKG\.build_script_json/);
  assert.equal(executeCalls[0].binds.session_id, "S-INDB");
  assert.equal(executeCalls[0].binds.select_ai_profile, "STWL_GAMEPLAY_AI");
  assert.equal(executeCalls[0].binds.agent_team_name, "STWL_GAMEPLAY_COMMENTARY_TEAM");
});

test("auto-initializes the commentary package plus Select AI profile and agent team", async () => {
  const executeCalls = [];
  const oracleConnection = {
    async execute(sql) {
      executeCalls.push(sql);
      if (/build_script_json/.test(sql)) {
        return {
          outBinds: {
            result: JSON.stringify({
              ok: 1,
              source: "oracle-ai-database-agent",
              commentary: "Agent team used SQL telemetry for a 64 point finish.",
            }),
          },
        };
      }
      return {};
    },
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "true",
    SELECT_AI_AUTO_INIT: "true",
    SELECT_AI_PROFILE: "STWL_GAMEPLAY_AI",
    SELECT_AI_AGENT_TEAM: "STWL_GAMEPLAY_COMMENTARY_TEAM",
    SELECT_AI_REGION: "uk-london-1",
    SELECT_AI_MODEL: "cohere.command-r-08-2024",
    ORACLE_USER: "ADMIN",
  }, async () => {
    const result = await callInDbAgent(
      normalizeSummary({ session_id: "S-AUTO", player_id: "P-AUTO", score: 64 }),
      200,
      {
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
      }
    );

    assert.equal(result.source, "oracle-ai-database-agent");
    assert.equal(result.commentary, "Agent team used SQL telemetry for a 64 point finish.");
  });

  assert.ok(executeCalls.some((sql) => /CREATE OR REPLACE PACKAGE STWL_COMMENTARY_PKG/i.test(sql)));
  assert.ok(executeCalls.some((sql) => /DBMS_CLOUD_AI\.CREATE_PROFILE/i.test(sql)));
  assert.ok(executeCalls.some((sql) => /DBMS_CLOUD_AI_AGENT\.CREATE_TEAM/i.test(sql)));
  assert.ok(executeCalls.some((sql) => /STWL_COMMENTARY_PKG\.build_script_json/i.test(sql)));
});

test("uses in-db agent output as the commentary when Canvas is not configured", async () => {
  const oracleConnection = {
    async execute() {
      return {
        outBinds: {
          result: JSON.stringify({
            ok: true,
            source: "oracle-ai-database-agent",
            commentary: "In-db agent called the freeze and the 31 point finish.",
          }),
        },
      };
    },
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S3",
          player_id: "P3",
          player_name: "Ada",
          score: 31,
          freezes: 1,
          trail_crosses: 1,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
      }
    );
    assert.equal(response.source, "oracle-ai-database-agent");
    assert.equal(response.commentary, "In-db agent called the freeze and the 31 point finish.");
    assert.equal(response.in_db_agent.source, "oracle-ai-database-agent");
    assert.equal(response.canvas, null);
  });
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

test("falls back to deterministic SQL commentary when in-db agent and Canvas fail", async () => {
  const endpoint = "https://paf.example.test:8080/agentFactory/v1/agentBuilder/run/STWL";
  const oracleConnection = {
    async execute() {
      return {
        outBinds: {
          result: JSON.stringify({
            ok: false,
            source: "oracle-ai-database-error",
            error: "profile_missing",
          }),
        },
      };
    },
  };
  const requestJson = async () => ({
    status: 503,
    headers: {},
    elapsed_ms: 10,
    payload: { message: "unavailable" },
  });

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: endpoint,
    PAF_CANVAS_ROOM_ID: "",
    PAF_CANVAS_TIMEOUT_MS: "1000",
    PAF_CANVAS_VERIFY_TLS: "false",
    PAF_CANVAS_SESSION_COOKIE: "agent_factory_session=test",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-FALLBACK",
          player_id: "P-FALLBACK",
          player_name: "Ada",
          score: 19,
          trash_collected: 3,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        requestJson,
      }
    );

    assert.equal(response.source, "request-summary");
    assert.equal(response.canvas, null);
    assert.equal(response.in_db_agent, null);
    assert.match(response.commentary, /19 points/);
    assert.ok(response.commentary.length <= 200);
    assert.match(response.warning, /indb_agent_profile_missing/);
    assert.match(response.warning, /paf_canvas:paf_canvas_http_503/);
  });
});

test("passes the in-db agent draft into Canvas and reports fallback source", async () => {
  const endpoint = "https://paf.example.test:8080/agentFactory/v1/agentBuilder/run/STWL";
  const oracleConnection = {
    async execute() {
      return {
        outBinds: {
          result: JSON.stringify({
            ok: true,
            source: "select-ai",
            commentary: "Select AI draft: freeze powerup, 2 crossings, 88 points.",
          }),
        },
      };
    },
  };
  const requestJson = async (_url, options) => {
    const body = JSON.parse(options.body || "{}");
    assert.match(body.message, /oracle_ai_database_draft=Select AI draft/);
    assert.match(body.message, /trail_crosses=2/);
    return {
      status: 200,
      headers: {},
      elapsed_ms: 22,
      payload: { message: "Canvas polished the SQL draft: freeze, two crossings, 88 points." },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: endpoint,
    PAF_CANVAS_ROOM_ID: "",
    PAF_CANVAS_TIMEOUT_MS: "1000",
    PAF_CANVAS_VERIFY_TLS: "false",
    PAF_CANVAS_SESSION_COOKIE: "agent_factory_session=test",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S4",
          player_id: "P4",
          player_name: "Grace",
          score: 88,
          trail_crosses: 2,
          freezes: 1,
          powerups: { powerup_freeze: 1 },
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        requestJson,
      }
    );

    assert.equal(response.source, "paf-canvas");
    assert.equal(response.fallback_source, "select-ai");
    assert.equal(response.in_db_agent.source, "select-ai");
    assert.equal(response.commentary, "Canvas polished the SQL draft: freeze, two crossings, 88 points.");
  });
});

test("ships SQL assets for Select AI profile and in-database agent workflow", () => {
  const packageSql = readFileSync(new URL("../../deploy/db/stwl_commentary_pkg.sql", import.meta.url), "utf8");
  const profileSql = readFileSync(new URL("../../deploy/db/select_ai_profile_template.sql", import.meta.url), "utf8");
  const teamSql = readFileSync(new URL("../../deploy/db/select_ai_agent_team_template.sql", import.meta.url), "utf8");

  assert.match(packageSql, /CREATE OR REPLACE PACKAGE\s+stwl_commentary_pkg/i);
  assert.match(packageSql, /stwl_game_events/i);
  assert.match(packageSql, /DBMS_CLOUD_AI_AGENT\.RUN_TEAM/i);
  assert.match(packageSql, /DBMS_CLOUD_AI\.GENERATE/i);
  assert.match(packageSql, /oracle-ai-database-deterministic/i);
  assert.match(packageSql, /\bhistory\s+AS\s*\(/i);
  assert.doesNotMatch(packageSql, /\bprior\s+AS\s*\(/i);
  assert.match(packageSql, /TO_CLOB\('\{\}'\)/i);
  assert.doesNotMatch(packageSql, /RETURN\s+JSON_OBJECT\([\s\S]*?RETURNING\s+CLOB[\s\S]*?\);/i);

  assert.match(profileSql, /DBMS_CLOUD_ADMIN\.ENABLE_RESOURCE_PRINCIPAL/i);
  assert.match(profileSql, /DBMS_CLOUD_AI\.CREATE_PROFILE/i);
  assert.match(profileSql, /STWL_GAMEPLAY_AI/i);
  assert.match(profileSql, /OCI\$RESOURCE_PRINCIPAL/i);
  assert.match(profileSql, /STWL_GAME_EVENTS/i);
  assert.match(profileSql, /STWL_SESSION_SUMMARY/i);

  assert.match(teamSql, /DBMS_CLOUD_AI_AGENT\.CREATE_TOOL/i);
  assert.match(teamSql, /DBMS_CLOUD_AI_AGENT\.CREATE_AGENT/i);
  assert.match(teamSql, /DBMS_CLOUD_AI_AGENT\.CREATE_TEAM/i);
  assert.match(teamSql, /STWL_GAMEPLAY_COMMENTARY_TEAM/i);
  assert.match(teamSql, /STWL_GAMEPLAY_AI/i);

  const generated = selectAiInitStatements({
    selectAiProfile: "STWL_GAMEPLAY_AI",
    agentTeamName: "STWL_GAMEPLAY_COMMENTARY_TEAM",
    selectAiObjectOwner: "ADMIN",
    selectAiRegion: "uk-london-1",
    selectAiModel: "cohere.command-r-08-2024",
    selectAiApiFormat: "COHERE",
  }).join("\n");
  assert.match(generated, /DBMS_CLOUD_AI\.CREATE_PROFILE/i);
  assert.match(generated, /DBMS_CLOUD_AI_AGENT\.CREATE_TEAM/i);
  assert.match(generated, /DBMS_CLOUD_ADMIN\.ENABLE_RESOURCE_PRINCIPAL/i);
  assert.match(generated, /OCI\$RESOURCE_PRINCIPAL/i);
});
