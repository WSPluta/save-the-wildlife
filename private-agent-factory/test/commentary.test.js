import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.PAF_DISABLE_SERVER = "1";

const {
  buildCanvasMessage,
  buildBotPolicyCatalog,
  buildCommentary,
  buildMatchContext,
  callInDbAgent,
  callModelProvider,
  callPafCanvas,
  evaluateModelOutputs,
  extractCanvasText,
  handleMcpRequest,
  learningTraceStatements,
  matchIntelligenceStatements,
  modelRouterConfig,
  normalizeSummary,
  selectAiInitStatements,
  summarizeAdapterHealth,
} = await import("../index.js");

const {
  parseArgs: parseTrainingExportArgs,
  rowToTrainingRecord,
} = await import("../scripts/export-training-examples.mjs");

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

test("exposes read-only MCP tools for PAF Canvas to call game telemetry", async () => {
  await withEnv({
    PAF_MCP_ENABLED: "true",
    PAF_MCP_SERVER_NAME: "save-the-wildlife-match-intelligence",
    ORACLE_CONNECT_STRING: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    INDB_AGENT_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "off",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
  }, async () => {
    const init = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    assert.equal(init.result.serverInfo.name, "save-the-wildlife-match-intelligence");
    assert.deepEqual(init.result.capabilities, { tools: {} });

    const listed = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const toolNames = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(toolNames, [
      "get_live_match_context",
      "get_session_summary",
      "create_commentary_line",
    ]);
    assert.ok(!toolNames.includes("query_sql"));
  });
});

test("MCP commentary tool returns bounded evidence-shaped content", async () => {
  await withEnv({
    PAF_MCP_ENABLED: "true",
    ORACLE_CONNECT_STRING: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    INDB_AGENT_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "off",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
  }, async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_commentary_line",
        arguments: {
          room_id: "ROOM-0001",
          output_format: "live_line",
          max_chars: 200,
        },
      },
    });

    assert.equal(response.result.isError, false);
    assert.equal(response.result.content[0].type, "text");
    assert.equal(response.result.structuredContent.ok, true);
    assert.ok(response.result.structuredContent.commentary.length <= 200);
  });
});

test("serves approved PAF-trained bot policy cards", () => {
  const catalog = buildBotPolicyCatalog();

  assert.equal(catalog.ok, true);
  assert.equal(catalog.schema_version, "stwl.bot-policy.v1");
  assert.equal(catalog.teacher, "Oracle Private Agent Factory");
  assert.equal(catalog.deterministic_execution, true);
  assert.ok(catalog.runtime_contract.includes("deterministically"));
  assert.ok(catalog.policies.length >= 4);
  assert.ok(catalog.policies.some((policy) => policy.id === "shield-hunter-v1"));
  for (const policy of catalog.policies) {
    assert.ok(policy.throttle >= 0.15 && policy.throttle <= 1);
    assert.ok(policy.aggression >= 0 && policy.aggression <= 1);
    assert.ok(["low", "medium", "high"].includes(policy.risk));
    assert.ok(Array.isArray(policy.targetPriority));
    assert.ok(!/\b(fuck|shit|bitch|asshole|bastard|dick|cunt)\b/i.test(`${policy.name} ${policy.notes}`));
  }
});

test("carries PAF-trained bot policy evidence into prompts and commentary", async () => {
  const summary = normalizeSummary({
    session_id: "S-BOT",
    player_id: "bot-1",
    player_name: "Bot Data 1",
    score: 12,
    trash_collected: 4,
    freezes: 1,
    bot_policy: {
      id: "shield-hunter-v1",
      name: "PAF Shield Hunter",
      source: "paf",
      risk: "medium",
      targetPriority: ["powerup_shield", "trash"],
      objective: "Prioritize shields, then clean nearby trash.",
    },
    bot_learning_outcome: "policy_collected_items",
  });

  const message = buildCanvasMessage(summary);
  assert.match(message, /bot_policy=PAF Shield Hunter/);
  assert.match(message, /targets=powerup_shield,trash/);
  assert.match(message, /bot_learning_outcome=policy_collected_items/);

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "off",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
  }, async () => {
    const response = await buildCommentary(
      { summary, output_format: "live_line" },
      { skipOracleSummary: true }
    );

    assert.equal(response.ok, true);
    assert.match(response.commentary, /PAF Shield Hunter produced 12 pts/);
    assert.ok(response.commentary.length <= 200);
  });
});

test("extracts text from common PAF Canvas response shapes", () => {
  assert.equal(extractCanvasText({ payload: { message: "Canvas line" } }), "Canvas line");
  assert.equal(extractCanvasText({ message: { content: [{ text: "Nested line" }] } }), "Nested line");
  assert.equal(extractCanvasText({ choices: [{ message: { content: "Choice line" } }] }), "Choice line");
});

test("summarizes private model adapter upstream health", () => {
  const summary = summarizeAdapterHealth([
    { ok: true, provider: "oci-base", runtime_mode: "upstream-llm", upstream_format: "ollama", generation_ready: true },
    { ok: true, provider: "oci-fine-tuned", runtime_mode: "upstream-llm", upstream_format: "ollama", generation_ready: true },
  ]);

  assert.equal(summary.upstream_llm_ready, true);
  assert.equal(summary.generation_ready, true);
  assert.deepEqual(summary.provider_counts, { "oci-base": 1, "oci-fine-tuned": 1 });
  assert.deepEqual(summary.runtime_counts, {
    "oci-base:upstream-llm": 1,
    "oci-fine-tuned:upstream-llm": 1,
  });
  assert.deepEqual(summary.upstream_format_counts, { ollama: 2 });
  assert.deepEqual(summary.generation_ready_counts, { ready: 2, failed: 0, unknown: 0 });
});

test("does not mark private model adapters ready when generation probe fails", () => {
  const summary = summarizeAdapterHealth([
    { ok: true, provider: "oci-base", runtime_mode: "upstream-llm", upstream_format: "ollama", generation_ready: true },
    { ok: true, provider: "oci-fine-tuned", runtime_mode: "upstream-llm", upstream_format: "ollama", generation_ready: false },
  ]);

  assert.equal(summary.upstream_llm_ready, false);
  assert.equal(summary.generation_ready, false);
  assert.deepEqual(summary.generation_ready_counts, { ready: 1, failed: 1, unknown: 0 });
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

test("returns in-db commentary when Canvas exceeds the remaining commentary budget", async () => {
  const endpoint = "https://paf.example.test:8080/agentFactory/v1/agentBuilder/run/STWL";
  const executeCalls = [];
  const canvasCalls = [];
  const oracleConnection = {
    async execute() {
      executeCalls.push("call");
      return {
        outBinds: {
          result: JSON.stringify({
            ok: true,
            source: "select-ai",
            commentary: "Select AI grounded Ada's 55 point finish in DB evidence.",
            summary: {
              session_id: "S-BUDGET",
              player_id: "P-BUDGET",
              player_name: "Ada",
              score: 55,
              trash_collected: 8,
            },
          }),
        },
      };
    },
  };
  const requestJson = async (url, options) => {
    canvasCalls.push({ url, timeoutMs: options.timeoutMs });
    await sleep(Number(options.timeoutMs || 0) + 80);
    return {
      status: 200,
      headers: {},
      elapsed_ms: Number(options.timeoutMs || 0) + 80,
      payload: { message: "Canvas eventually polished the line, too late." },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: endpoint,
    PAF_CANVAS_TIMEOUT_MS: "8000",
    PAF_CANVAS_RETURN_RESERVE_MS: "25",
    PAF_CANVAS_MIN_TIMEOUT_MS: "20",
    PAF_COMMENTARY_DEADLINE_MS: "150",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    OCI_BASE_MODEL_ENDPOINT_URL: "",
    OCI_FT_MODEL_ENDPOINT_URL: "",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const started = Date.now();
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-BUDGET",
          player_id: "P-BUDGET",
          player_name: "Ada",
          score: 55,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        requestJson,
        traceId: "TRACE-BUDGET",
      }
    );

    assert.ok(Date.now() - started < 500);
    assert.equal(response.source, "select-ai");
    assert.equal(response.commentary, "Select AI grounded Ada's 55 point finish in DB evidence.");
    assert.equal(response.warning, null);
    assert.match(response.diagnostics.warnings.join("; "), /paf_canvas:paf_canvas_timeout_/);
    assert.match(response.warnings.join("; "), /paf_canvas:paf_canvas_timeout_/);
    assert.equal(response.trace_id, "TRACE-BUDGET");
    assert.equal(response.route_mode, "shadow");
    assert.equal(response.primary_provider, "oci-base");
    assert.equal(response.candidate_provider, "oci-fine-tuned");
    assert.ok(response.evidence_hash);
    assert.ok(response.prompt_hash);
    assert.equal(response.in_db_agent.source, "select-ai");
    assert.equal(response.canvas, null);
  });

  assert.equal(executeCalls.length, 1);
  assert.equal(canvasCalls.length, 1);
  assert.ok(canvasCalls[0].timeoutMs < 150);
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

test("routes base and fine-tuned OCI model endpoints in shadow mode", async () => {
  const calls = [];
  const modelRequestJson = async (url, options) => {
    const body = JSON.parse(options.body || "{}");
    calls.push({ url, body });
    assert.equal(body.trace_id, "TRACE-UNIT");
    assert.equal(body.route_context.primary_provider, "oci-base");
    assert.equal(body.route_context.candidate_provider, "oci-fine-tuned");
    const isFineTuned = url.includes("fine-tuned");
    return {
      status: 200,
      headers: {},
      elapsed_ms: isFineTuned ? 88 : 104,
      payload: {
        ok: true,
        provider: isFineTuned ? "oci-fine-tuned" : "oci-base",
        model_id: isFineTuned ? "stwl-ft-v1" : "stwl-base-v1",
        text: isFineTuned
          ? "Ada closed on 42 points cleanly."
          : "Ada finished with 42 points after a clean run.",
        tokens: isFineTuned ? 9 : 12,
        finish_reason: "stop",
        runtime_mode: "upstream-llm",
        upstream_configured: true,
        facts_policy: "facts-in-memory-behavior-in-weights",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    OCI_MODEL_ENDPOINT_AUTH_SECRET: "unit-secret",
    PAF_TRACE_PERSIST: "false",
    PAF_EVAL_ENABLED: "true",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-MODEL",
          room_id: "ROOM-MODEL",
          player_id: "P-MODEL",
          player_name: "Ada",
          score: 42,
          trash_collected: 7,
        },
      },
      {
        skipOracleSummary: true,
        traceId: "TRACE-UNIT",
        modelRequestJson,
      }
    );

    assert.equal(response.source, "oci-base");
    assert.equal(response.fallback_source, "request-summary");
    assert.equal(response.commentary, "Ada finished with 42 points after a clean run.");
    assert.equal(response.trace_id, "TRACE-UNIT");
    assert.equal(response.route_mode, "shadow");
    assert.equal(response.primary_provider, "oci-base");
    assert.equal(response.candidate_provider, "oci-fine-tuned");
    assert.equal(response.model_id, "stwl-base-v1");
    assert.equal(response.model_route.primary.model_id, "stwl-base-v1");
    assert.equal(response.model_route.candidate.model_id, "stwl-ft-v1");
    assert.equal(response.model_route.primary.runtime_mode, "upstream-llm");
    assert.equal(response.model_route.candidate.runtime_mode, "upstream-llm");
    assert.equal(response.model_route.primary.upstream_configured, true);
    assert.equal(response.model_route.candidate.facts_policy, "facts-in-memory-behavior-in-weights");
    assert.equal(response.model_route.trace_persisted, false);
    assert.equal(response.eval_scores.verdict, "candidate_ready");
    assert.equal(response.promotion_verdict, "candidate_ready");
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].body.prompt, /Write exactly one in-world Save the Wildlife commentator line/);
  assert.match(calls[0].body.prompt, /score=42/);
  assert.match(calls[0].body.prompt, /Safe draft line: Ada scored 42 with 7 clean pickups\./);
  assert.match(calls[0].body.prompt, /keep the exact player text "Ada" and exact score "42"/);
  assert.equal(calls[0].body.max_tokens, 40);
  assert.equal(calls[0].body.evidence.summary.score, 42);
  assert.equal(calls[0].body.evidence.evidence.latest_event, null);
});

test("selects grounded safe draft when live LLM response is not usable", async () => {
  const calls = [];
  const modelRequestJson = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return {
      status: 200,
      elapsed_ms: 25,
      payload: {
        ok: true,
        provider: "oci-base",
        model_id: "stwl-base-v1",
        text: "I can't help with this request.",
        tokens: 8,
        finish_reason: "stop",
        runtime_mode: "upstream-llm",
        upstream_configured: true,
        facts_policy: "facts-in-memory-behavior-in-weights",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "primary",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_LIVE_LINE_SAFE_DRAFT_FIRST: "true",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_MODEL_ENDPOINT_AUTH_SECRET: "unit-secret",
    PAF_TRACE_PERSIST: "false",
    PAF_EVAL_ENABLED: "true",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-REPAIR",
          room_id: "ROOM-REPAIR",
          player_id: "P-REPAIR",
          player_name: "Smoke Player",
          score: 3,
          trash_collected: 3,
          trail_crosses: 0,
          powerups: { powerup_speed: 1 },
        },
      },
      {
        skipOracleSummary: true,
        traceId: "TRACE-REPAIR",
        modelRequestJson,
      }
    );

    assert.equal(response.source, "oci-base");
    assert.equal(response.fallback_source, "request-summary");
    assert.equal(response.commentary, "Smoke Player scored 3 after speed powerup.");
    assert.equal(response.model_route.primary.grounding_mode, "safe_draft_selection");
    assert.equal(response.model_route.primary.repair_of_reason, "model_response_unselected");
    assert.match(response.model_route.primary.warnings.join("; "), /safe_draft_selected_after_llm_response/);
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Allowed line A: Smoke Player scored 3 after speed powerup\./);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].route_context.grounded_repair, true);
});

test("does not block live model commentary on slow trace persistence", async () => {
  const oracleConnection = {
    execute: () => new Promise(() => {}),
  };
  const modelRequestJson = async () => ({
    status: 200,
    headers: {},
    elapsed_ms: 25,
    payload: {
      ok: true,
      provider: "oci-base",
      model_id: "stwl-base-fast",
      text: "Ada finished with 42 points after one freeze.",
      tokens: 9,
      finish_reason: "stop",
      runtime_mode: "upstream-llm",
      upstream_configured: true,
      facts_policy: "facts-in-memory-behavior-in-weights",
    },
  });

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "primary",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_MODEL_ENDPOINT_TIMEOUT_MS: "1000",
    PAF_COMMENTARY_DEADLINE_MS: "1000",
    PAF_TRACE_PERSIST: "true",
  }, async () => {
    const started = Date.now();
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-LIVE-PERSIST",
          player_id: "P-LIVE-PERSIST",
          player_name: "Ada",
          score: 42,
          freezes: 1,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        traceId: "TRACE-LIVE-PERSIST",
        modelRequestJson,
      }
    );

    assert.equal(response.source, "oci-base");
    assert.equal(response.commentary, "Ada finished with 42 points after one freeze.");
    assert.equal(response.model_route.trace_persisted, false);
    assert.ok(Date.now() - started < 500, "live route should not wait for trace persistence");
  });
});

test("runs shadow primary and candidate model calls concurrently", async () => {
  const calls = [];
  const started = Date.now();
  const modelRequestJson = async (url) => {
    calls.push({ url, started_at_ms: Date.now() - started });
    await sleep(150);
    const isFineTuned = url.includes("fine-tuned");
    return {
      status: 200,
      headers: {},
      elapsed_ms: 150,
      payload: {
        ok: true,
        provider: isFineTuned ? "oci-fine-tuned" : "oci-base",
        model_id: isFineTuned ? "stwl-ft-concurrent" : "stwl-base-concurrent",
        text: isFineTuned
          ? "Ada held 42 points after one recorded freeze."
          : "Ada finished with 42 points after one recorded freeze.",
        tokens: isFineTuned ? 8 : 9,
        finish_reason: "stop",
        runtime_mode: "upstream-llm",
        upstream_configured: true,
        facts_policy: "facts-in-memory-behavior-in-weights",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-CONCURRENT-MODEL",
          player_id: "P-CONCURRENT-MODEL",
          player_name: "Ada",
          score: 42,
          freezes: 1,
        },
      },
      {
        skipOracleSummary: true,
        traceId: "TRACE-CONCURRENT-MODEL",
        modelRequestJson,
      }
    );

    const elapsed = Date.now() - started;
    assert.equal(response.source, "oci-base");
    assert.equal(response.model_route.primary.model_id, "stwl-base-concurrent");
    assert.equal(response.model_route.candidate.model_id, "stwl-ft-concurrent");
    assert.equal(calls.length, 2);
    assert.ok(
      elapsed < 260,
      `shadow route should be concurrent; elapsed ${elapsed}ms looked serial`
    );
    assert.ok(
      Math.abs(calls[0].started_at_ms - calls[1].started_at_ms) < 50,
      `shadow calls should start together: ${JSON.stringify(calls)}`
    );
  });
});

test("keeps shadow candidate timeout as diagnostics when primary model returns commentary", async () => {
  const modelRequestJson = async (url) => {
    if (url.includes("fine-tuned")) {
      throw new Error("http_timeout_15000ms");
    }
    return {
      status: 200,
      headers: {},
      elapsed_ms: 48,
      payload: {
        ok: true,
        provider: "oci-base",
        model_id: "stwl-base-live",
        text: "Ada held 42 points after a steady run.",
        tokens: 10,
        finish_reason: "stop",
        runtime_mode: "upstream-llm",
        upstream_configured: true,
        facts_policy: "facts-in-memory-behavior-in-weights",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-SHADOW-DIAG",
          player_id: "P-SHADOW-DIAG",
          player_name: "Ada",
          score: 42,
        },
      },
      {
        skipOracleSummary: true,
        traceId: "TRACE-SHADOW-DIAG",
        modelRequestJson,
      }
    );

    assert.equal(response.ok, true);
    assert.equal(response.source, "oci-base");
    assert.equal(response.warning, null);
    assert.match(response.diagnostics.warnings.join("; "), /oci-fine-tuned:http_timeout_15000ms/);
    assert.equal(response.model_route.primary.runtime_mode, "upstream-llm");
    assert.equal(response.model_route.candidate.ok, false);
  });
});

test("repairs model output when it leaks meta commentary", async () => {
  const modelRequestJson = async () => ({
    status: 200,
    headers: {},
    elapsed_ms: 38,
    payload: {
      ok: true,
      provider: "oci-base",
      model_id: "stwl-base-meta",
      text: "Oracle AI Database models predict Ada will keep improving.",
      tokens: 9,
      finish_reason: "stop",
      runtime_mode: "upstream-llm",
      upstream_configured: true,
      facts_policy: "facts-in-memory-behavior-in-weights",
    },
  });

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "primary",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-META",
          player_id: "P-META",
          player_name: "Ada",
          score: 42,
          trash_collected: 7,
          trail_crosses: 1,
          freezes: 1,
          powerups: { powerup_shield: 1 },
        },
      },
      {
        skipOracleSummary: true,
        traceId: "TRACE-META",
        modelRequestJson,
      }
    );

    assert.equal(response.ok, true);
    assert.equal(response.source, "oci-base");
    assert.equal(response.fallback_source, "request-summary");
    assert.doesNotMatch(response.commentary, /Oracle|Database|model|predict/i);
    assert.match(response.commentary, /Ada|42|shield|trail|freeze/i);
    assert.match(response.model_route.primary.warnings.join("; "), /initial_model_output_rejected_meta_commentary/);
    assert.match(response.model_route.primary.warnings.join("; "), /safe_draft_selected_after_llm_response/);
    assert.equal(response.model_route.primary.grounding_mode, "safe_draft_selection");
    assert.equal(response.model_route.primary.runtime_mode, "upstream-llm");
  });
});

test("keeps primary model timeout as diagnostics when in-db agent returns commentary", async () => {
  const oracleConnection = {
    async execute() {
      return {
        outBinds: {
          result: JSON.stringify({
            ok: true,
            source: "select-ai",
            commentary: "Ada froze once after crossing a trail and still finished on 42.",
          }),
        },
      };
    },
  };
  const modelRequestJson = async () => {
    throw new Error("http_timeout_15000ms");
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_FAST_PATH_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-INDB-MODEL-TIMEOUT",
          player_id: "P-INDB-MODEL-TIMEOUT",
          player_name: "Ada",
          score: 42,
          trail_crosses: 1,
          freezes: 1,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        traceId: "TRACE-INDB-MODEL-TIMEOUT",
        modelRequestJson,
      }
    );

    assert.equal(response.source, "select-ai");
    assert.equal(response.warning, null);
    assert.equal(response.in_db_agent.source, "select-ai");
    assert.match(response.diagnostics.warnings.join("; "), /oci-base:http_timeout_15000ms/);
    assert.match(response.diagnostics.warnings.join("; "), /oci-fine-tuned:http_timeout_15000ms/);
  });
});

test("does not let slow model diagnostics block grounded in-db commentary", async () => {
  const oracleConnection = {
    async execute() {
      return {
        outBinds: {
          result: JSON.stringify({
            ok: true,
            source: "select-ai",
            commentary: "Select AI kept the live line grounded in collected trash.",
          }),
        },
      };
    },
  };
  let modelCalls = 0;
  const modelRequestJson = async () => {
    modelCalls += 1;
    await sleep(1000);
    return {
      status: 200,
      headers: {},
      elapsed_ms: 1000,
      payload: {
        ok: true,
        provider: "oci-base",
        model_id: "slow-model",
        text: "This should not block the live click.",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_FAST_PATH_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    PAF_COMMENTARY_DEADLINE_MS: "300",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const started = Date.now();
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-BUDGETED-MODEL",
          player_id: "P-BUDGETED-MODEL",
          player_name: "Ada",
          score: 3,
          trash_collected: 3,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        traceId: "TRACE-BUDGETED-MODEL",
        modelRequestJson,
      }
    );

    assert.ok(Date.now() - started < 700);
    assert.equal(response.source, "select-ai");
    assert.equal(response.commentary, "Select AI kept the live line grounded in collected trash.");
    assert.equal(response.trace_id, "TRACE-BUDGETED-MODEL");
    assert.equal(response.model_route.primary.skipped, true);
    assert.equal(response.model_route.primary.error, "model_route_budget_exhausted");
    assert.match(response.diagnostics.warnings.join("; "), /model_route:model_route_budget_exhausted/);
  });

  assert.equal(modelCalls, 0);
});

test("persists skipped model route traces when live model diagnostics time out", async () => {
  const executed = [];
  const oracleConnection = {
    async execute(sql, binds = {}) {
      executed.push({ sql: String(sql), binds });
      if (String(sql).includes("build_script_json")) {
        return {
          outBinds: {
            result: JSON.stringify({
              ok: true,
              source: "select-ai",
              commentary: "Select AI kept Ada grounded on 42 after one freeze.",
            }),
          },
        };
      }
      return {};
    },
  };
  const modelRequestJson = async () => {
    await sleep(1000);
    return {
      status: 200,
      headers: {},
      elapsed_ms: 1000,
      payload: {
        ok: true,
        provider: "oci-base",
        model_id: "too-slow-model",
        text: "Ada finished with 42 points after one freeze.",
        runtime_mode: "upstream-llm",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_FAST_PATH_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    OCI_MODEL_ENDPOINT_TIMEOUT_MS: "500",
    PAF_COMMENTARY_DEADLINE_MS: "700",
    PAF_TRACE_PERSIST: "true",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-SKIPPED-PERSIST",
          player_id: "P-SKIPPED-PERSIST",
          player_name: "Ada",
          score: 42,
          freezes: 1,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        traceId: "TRACE-SKIPPED-PERSIST",
        modelRequestJson,
      }
    );

    assert.equal(response.source, "select-ai");
    assert.equal(response.model_route.trace_persisted, true);
    assert.equal(response.model_route.primary.skipped, true);
    assert.match(response.model_route.primary.error, /model_route_timeout|model_route_budget/);
    assert.ok(
      executed.some((entry) => entry.sql.includes("MERGE INTO STWL_MODEL_TRACES")),
      "expected skipped route to persist trace metadata"
    );
    assert.ok(
      executed.some((entry) => entry.sql.includes("MERGE INTO STWL_MODEL_OUTPUTS")),
      "expected skipped route to persist timeout output rows"
    );
  });
});

test("starts deferred model route before slow in-db fallback completes", async () => {
  let inDbFinished = false;
  const modelCalls = [];
  const oracleConnection = {
    async execute() {
      await sleep(80);
      inDbFinished = true;
      return {
        outBinds: {
          result: JSON.stringify({
            ok: true,
            source: "select-ai",
            commentary: "Select AI keeps Ada grounded on 42 after one freeze.",
          }),
        },
      };
    },
  };
  const modelRequestJson = async (url) => {
    modelCalls.push({ url, inDbFinishedAtCall: inDbFinished });
    const isFineTuned = url.includes("fine-tuned");
    return {
      status: 200,
      headers: {},
      elapsed_ms: 12,
      payload: {
        ok: true,
        provider: isFineTuned ? "oci-fine-tuned" : "oci-base",
        model_id: isFineTuned ? "stwl-ft-deferred" : "stwl-base-deferred",
        text: "Ada scored 42 after one freeze.",
        runtime_mode: "upstream-llm",
        upstream_configured: true,
        facts_policy: "facts-in-memory-behavior-in-weights",
      },
    };
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "false",
    PAF_MODEL_FAST_PATH_ENABLED: "false",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    PAF_TRACE_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-DEFERRED-MODEL",
          player_id: "P-DEFERRED-MODEL",
          player_name: "Ada",
          score: 42,
          freezes: 1,
        },
      },
      {
        skipOracleSummary: true,
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
        traceId: "TRACE-DEFERRED-MODEL",
        modelRequestJson,
      }
    );

    assert.equal(response.source, "select-ai");
    assert.equal(response.commentary, "Select AI keeps Ada grounded on 42 after one freeze.");
    assert.equal(response.model_route.primary.runtime_mode, "upstream-llm");
    assert.equal(response.model_route.primary.ok, true);
    assert.equal(modelCalls.length, 2);
    assert.equal(modelCalls[0].inDbFinishedAtCall, false);
  });
});

test("uses model fast path before slow Canvas enrichment when endpoints are configured", async () => {
  const modelCalls = [];
  let canvasCalls = 0;
  const modelRequestJson = async (url, options) => {
    const body = JSON.parse(options.body || "{}");
    modelCalls.push({ url, body });
    const isFineTuned = url.includes("fine-tuned");
    return {
      status: 200,
      headers: {},
      elapsed_ms: isFineTuned ? 22 : 28,
      payload: {
        ok: true,
        provider: isFineTuned ? "oci-fine-tuned" : "oci-base",
        model_id: isFineTuned ? "stwl-ft-fast" : "stwl-base-fast",
        text: isFineTuned
          ? "Ada closed on 77 points with a crisp finish."
          : "Ada finished on 77 points with a clean route.",
        tokens: isFineTuned ? 9 : 11,
        finish_reason: "stop",
        runtime_mode: "behavior-adapter",
        upstream_configured: false,
        facts_policy: "facts-in-memory-behavior-in-weights",
      },
    };
  };
  const requestJson = async () => {
    canvasCalls += 1;
    throw new Error("canvas_should_not_run_on_fast_path");
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    PAF_CANVAS_RUN_ENDPOINT_URL: "http://canvas.example.test/run",
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MODEL_FAST_PATH_ENABLED: "true",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_PRIMARY_MODEL_PROVIDER: "oci-base",
    PAF_CANDIDATE_MODEL_PROVIDER: "oci-fine-tuned",
    OCI_BASE_MODEL_ENDPOINT_URL: "http://base.example.test/v1/chat/completions",
    OCI_FT_MODEL_ENDPOINT_URL: "http://fine-tuned.example.test/v1/chat/completions",
    PAF_TRACE_PERSIST: "false",
    PAF_EVAL_ENABLED: "true",
  }, async () => {
    const response = await buildCommentary(
      {
        summary: {
          session_id: "S-FAST",
          room_id: "ROOM-FAST",
          player_id: "P-FAST",
          player_name: "Ada",
          score: 77,
          trash_collected: 3,
        },
      },
      {
        skipOracleSummary: true,
        traceId: "TRACE-FAST",
        modelRequestJson,
        requestJson,
      }
    );

    assert.equal(response.source, "oci-base");
    assert.equal(response.fallback_source, "request-summary");
    assert.equal(response.commentary, "Ada finished on 77 points with a clean route.");
    assert.equal(response.trace_id, "TRACE-FAST");
    assert.equal(response.model_route.primary.runtime_mode, "behavior-adapter");
    assert.equal(response.model_route.candidate.runtime_mode, "behavior-adapter");
    assert.equal(response.canvas, null);
    assert.equal(response.in_db_agent, null);
    assert.equal(response.evidence, null);
    assert.equal(response.promotion_verdict, "candidate_ready");
  });

  assert.equal(modelCalls.length, 2);
  assert.equal(canvasCalls, 0);
});

test("model router config clamps invalid numeric environment values", async () => {
  await withEnv({
    PAF_MODEL_ROUTE_MODE: "unexpected",
    OCI_MODEL_ENDPOINT_TIMEOUT_MS: "not-a-number",
    OCI_MODEL_ENDPOINT_TEMPERATURE: "hot",
    OCI_MODEL_ENDPOINT_MAX_TOKENS: "many",
  }, async () => {
    const config = modelRouterConfig();

    assert.equal(config.routeMode, "shadow");
    assert.equal(config.timeoutMs, 15000);
    assert.equal(config.temperature, 0.2);
    assert.equal(config.maxTokens, 120);
  });
});

test("builds match intelligence context with SQL, graph, replay, and memory evidence", async () => {
  const executeCalls = [];
  const oracleConnection = {
    async execute(sql) {
      executeCalls.push(sql);
      if (/FROM STWL_GAME_EVENTS/i.test(sql)) {
        return {
          rows: [
            {
              ID: 1,
              EVENT_TYPE: "powerup_collected",
              OCCURRED_AT: "2026-06-11T10:00:00.000Z",
              SCORE: 5,
              X: 1,
              Y: 0,
              Z: 2,
              RELATED_ITEM_ID: "I-SHIELD",
              METADATA_JSON: JSON.stringify({ powerup_type: "powerup_shield" }),
            },
            {
              ID: 2,
              EVENT_TYPE: "player_frozen",
              OCCURRED_AT: "2026-06-11T10:00:02.000Z",
              SCORE: 8,
              X: 3,
              Y: 0,
              Z: 4,
              RELATED_PLAYER_ID: "P-RIVAL",
              METADATA_JSON: JSON.stringify({ freeze_ms: 5000 }),
            },
          ],
        };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) {
        return {
          rows: [
            {
              CLIP_ID: "C1",
              SESSION_ID: "S-CTX",
              ROOM_ID: "ROOM-7",
              PLAYER_ID: "P-CTX",
              EVENT_TYPE: "player_frozen",
              EVENT_AT: "2026-06-11T10:00:02.000Z",
              TIMECODE_START_MS: -500,
              TIMECODE_END_MS: 1500,
              FRAME_COUNT: 60,
              MODERATION_STATUS: "approved",
              TAGS_JSON: JSON.stringify({ source: "replay-json" }),
              METADATA_JSON: JSON.stringify({ player_name: "Ada" }),
            },
          ],
        };
      }
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) {
        return {
          rows: [
            {
              MEMORY_ID: "M1",
              SESSION_ID: "S-OLD",
              PLAYER_ID: "P-CTX",
              MEMORY_TYPE: "session",
              SCORE: 77,
              CONTENT: "Ada previously used shield before a freeze.",
              METADATA_JSON: JSON.stringify({ tags: ["shield", "freeze"] }),
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  await withEnv({
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
    PAF_REPLAY_RETRIEVAL_ENABLED: "true",
    PAF_VECTOR_RETRIEVAL_ENABLED: "true",
  }, async () => {
    const context = await buildMatchContext(
      {
        summary: {
          session_id: "S-CTX",
          player_id: "P-CTX",
          player_name: "Ada",
          score: 88,
          trail_crosses: 1,
          freezes: 1,
          last_position: { x: 3, y: 0, z: 4 },
        },
      },
      { oracleConnection, skipOracleSummary: true }
    );

    assert.equal(context.ok, true);
    assert.equal(context.json_events.length, 2);
    assert.ok(context.graph_facts.some((fact) => fact.type === "player_frozen_by_trail"));
    assert.equal(context.replay_clips[0].clip_id, "C1");
    assert.equal(context.vector_memories[0].memory_id, "M1");
    assert.equal(context.capabilities.replay_clips, true);
    assert.equal(context.capabilities.vector_memories, true);
    assert.match(context.formats.replay_caption, /player_frozen clip/);
  });

  assert.ok(executeCalls.some((sql) => /STWL_GAME_EVENTS/i.test(sql)));
  assert.ok(executeCalls.some((sql) => /STWL_REPLAY_CLIPS/i.test(sql)));
  assert.ok(executeCalls.some((sql) => /STWL_AGENT_MEMORIES/i.test(sql)));
});

test("resolves room-only context to the latest SQL-backed session", async () => {
  const executeCalls = [];
  const oracleConnection = {
    async execute(sql, binds) {
      executeCalls.push({ sql, binds });
      if (/WHERE room_id = :roomId/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 1,
              EVENT_COUNT: 4,
            },
          ],
        };
      }
      if (/SUM\(CASE WHEN event_type = 'trash_collected'/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 3,
              TRASH_COLLECTED: 3,
              MARINE_HITS: 0,
              TRAIL_CROSSES: 1,
              FREEZES: 1,
              LAST_X: 12,
              LAST_Y: 0,
              LAST_Z: -4,
            },
          ],
        };
      }
      if (/event_type = 'powerup_collected'/i.test(sql)) {
        return {
          rows: [
            { METADATA_JSON: JSON.stringify({ powerup_type: "powerup_freeze" }) },
          ],
        };
      }
      if (/SELECT event_type, metadata_json/i.test(sql)) {
        return {
          rows: [
            {
              EVENT_TYPE: "game_over",
              METADATA_JSON: JSON.stringify({
                bot_policy: {
                  id: "shield-hunter-v1",
                  name: "PAF Shield Hunter",
                  source: "paf",
                  targetPriority: ["powerup_shield", "trash"],
                },
                bot_strategy: "shield-hunter-v1",
                learning_outcome: "policy_collected_items",
              }),
            },
          ],
        };
      }
      if (/event_type = 'game_over'/i.test(sql)) {
        return { rows: [{ PRIOR_BEST_SCORE: null }] };
      }
      if (/SELECT id, event_type/i.test(sql)) {
        return {
          rows: [
            {
              ID: 10,
              EVENT_TYPE: "trash_collected",
              OCCURRED_AT: "2026-06-21T15:57:00.000Z",
              SCORE: 1,
              X: 8,
              Y: 0,
              Z: -2,
              RELATED_ITEM_ID: "TR-1",
              METADATA_JSON: JSON.stringify({ item_type: "trash" }),
            },
            {
              ID: 11,
              EVENT_TYPE: "player_frozen",
              OCCURRED_AT: "2026-06-21T15:57:03.000Z",
              SCORE: 3,
              X: 12,
              Y: 0,
              Z: -4,
              RELATED_PLAYER_ID: "P-RIVAL",
              METADATA_JSON: JSON.stringify({ freeze_ms: 2500 }),
            },
          ],
        };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) return { rows: [] };
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };

  await withEnv({
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
    PAF_REPLAY_RETRIEVAL_ENABLED: "true",
    PAF_VECTOR_RETRIEVAL_ENABLED: "true",
  }, async () => {
    const context = await buildMatchContext(
      { roomId: "ROOM-LATEST", format: "live_line" },
      { oracleConnection }
    );

    assert.equal(context.ok, true);
    assert.equal(context.source, "oracle-match-intelligence");
    assert.equal(context.capabilities.room_session_resolved, true);
    assert.equal(context.capabilities.sql_summary, true);
    assert.equal(context.capabilities.json_events, true);
    assert.equal(context.summary.session_id, "S-HUMAN");
    assert.equal(context.summary.player_id, "P-HUMAN");
    assert.equal(context.summary.room_id, "ROOM-LATEST");
    assert.equal(context.summary.trash_collected, 3);
    assert.equal(context.summary.freezes, 1);
    assert.equal(context.summary.powerups.powerup_freeze, 1);
    assert.equal(context.summary.bot_policy.id, "shield-hunter-v1");
    assert.equal(context.summary.bot_learning_outcome, "policy_collected_items");
    assert.ok(context.graph_facts.some((fact) => fact.type === "bot_policy_guided_player"));
    assert.match(context.formats.live_line, /PAF Shield Hunter produced 3 pts/);
  });

  assert.ok(executeCalls.some((call) => /WHERE room_id = :roomId/i.test(call.sql)));
  assert.ok(executeCalls.some((call) => call.binds?.roomId === "ROOM-LATEST"));
});

test("builds room-only commentary from the latest SQL-backed room session", async () => {
  const executeCalls = [];
  const oracleConnection = {
    async execute(sql, binds) {
      executeCalls.push({ sql, binds });
      if (/WHERE room_id = :roomId/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 1,
              EVENT_COUNT: 4,
            },
          ],
        };
      }
      if (/SUM\(CASE WHEN event_type = 'trash_collected'/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 3,
              TRASH_COLLECTED: 3,
              MARINE_HITS: 0,
              TRAIL_CROSSES: 1,
              FREEZES: 1,
              LAST_X: 12,
              LAST_Y: 0,
              LAST_Z: -4,
            },
          ],
        };
      }
      if (/event_type = 'powerup_collected'/i.test(sql)) {
        return {
          rows: [
            { METADATA_JSON: JSON.stringify({ powerup_type: "powerup_freeze" }) },
          ],
        };
      }
      if (/event_type = 'game_over'/i.test(sql)) {
        return { rows: [{ PRIOR_BEST_SCORE: null }] };
      }
      if (/SELECT id, event_type/i.test(sql)) {
        return {
          rows: [
            {
              ID: 10,
              EVENT_TYPE: "trash_collected",
              OCCURRED_AT: "2026-06-21T15:57:00.000Z",
              SCORE: 1,
              X: 8,
              Y: 0,
              Z: -2,
              RELATED_ITEM_ID: "TR-1",
              METADATA_JSON: JSON.stringify({ item_type: "trash" }),
            },
            {
              ID: 11,
              EVENT_TYPE: "player_frozen",
              OCCURRED_AT: "2026-06-21T15:57:03.000Z",
              SCORE: 3,
              X: 12,
              Y: 0,
              Z: -4,
              RELATED_PLAYER_ID: "P-RIVAL",
              METADATA_JSON: JSON.stringify({ freeze_ms: 2500 }),
            },
          ],
        };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) return { rows: [] };
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MODEL_ROUTE_MODE: "off",
    PAF_TRACE_PERSIST: "false",
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
    PAF_REPLAY_RETRIEVAL_ENABLED: "true",
    PAF_VECTOR_RETRIEVAL_ENABLED: "true",
  }, async () => {
    const response = await buildCommentary(
      { roomId: "ROOM-LATEST", format: "live_line" },
      { oracleConnection }
    );

    assert.equal(response.ok, true);
    assert.equal(response.source, "oracle-match-intelligence");
    assert.equal(response.summary.session_id, "S-HUMAN");
    assert.equal(response.summary.player_id, "P-HUMAN");
    assert.equal(response.summary.room_id, "ROOM-LATEST");
    assert.equal(response.summary.trash_collected, 3);
    assert.equal(response.summary.freezes, 1);
    assert.equal(response.capabilities.room_session_resolved, true);
    assert.equal(response.capabilities.sql_summary, true);
    assert.equal(response.evidence.json_event_count, 2);
    assert.match(response.commentary, /Trail drama|frozen/i);
    assert.ok(response.commentary.length <= 200);
  });

  assert.ok(executeCalls.some((call) => /WHERE room_id = :roomId/i.test(call.sql)));
});

test("skips slow model routing for room-resolved live commentary", async () => {
  let modelCalls = 0;
  const oracleConnection = {
    async execute(sql) {
      if (/WHERE room_id = :roomId/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 1,
              EVENT_COUNT: 4,
            },
          ],
        };
      }
      if (/SUM\(CASE WHEN event_type = 'trash_collected'/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 3,
              TRASH_COLLECTED: 3,
              MARINE_HITS: 0,
              TRAIL_CROSSES: 1,
              FREEZES: 1,
              LAST_X: 12,
              LAST_Y: 0,
              LAST_Z: -4,
            },
          ],
        };
      }
      if (/event_type = 'powerup_collected'/i.test(sql)) {
        return { rows: [{ METADATA_JSON: JSON.stringify({ powerup_type: "powerup_freeze" }) }] };
      }
      if (/event_type = 'game_over'/i.test(sql)) return { rows: [{ PRIOR_BEST_SCORE: null }] };
      if (/SELECT id, event_type/i.test(sql)) {
        return {
          rows: [
            {
              ID: 11,
              EVENT_TYPE: "player_frozen",
              OCCURRED_AT: "2026-06-21T15:57:03.000Z",
              SCORE: 3,
              X: 12,
              Y: 0,
              Z: -4,
              RELATED_PLAYER_ID: "P-RIVAL",
              METADATA_JSON: JSON.stringify({ freeze_ms: 2500 }),
            },
          ],
        };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) return { rows: [] };
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const forbiddenModelRequest = async () => {
    modelCalls += 1;
    throw new Error("model_route_should_not_run_for_room_live_line");
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_MODEL_FAST_PATH_ENABLED: "true",
    OCI_BASE_MODEL_ENDPOINT_URL: "https://model.example.test/base",
    OCI_FT_MODEL_ENDPOINT_URL: "https://model.example.test/candidate",
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      { roomId: "ROOM-LATEST", format: "live_line" },
      { oracleConnection, modelRequestJson: forbiddenModelRequest }
    );

    assert.equal(response.source, "oracle-match-intelligence");
    assert.equal(response.capabilities.room_session_resolved, true);
    assert.equal(response.model_route.primary.skipped, true);
    assert.equal(response.model_route.primary.error, "room_live_line_uses_sql_context");
    assert.equal(modelCalls, 0);
  });
});

test("rejects unsupported Select AI commentary before returning room live line", async () => {
  const oracleConnection = {
    async execute(sql) {
      if (/WHERE room_id = :roomId/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 1,
              EVENT_COUNT: 4,
            },
          ],
        };
      }
      if (/SUM\(CASE WHEN event_type = 'trash_collected'/i.test(sql)) {
        return {
          rows: [
            {
              SESSION_ID: "S-HUMAN",
              ROOM_ID: "ROOM-LATEST",
              PLAYER_ID: "P-HUMAN",
              PLAYER_NAME: "Wojtek",
              SCORE: 3,
              TRASH_COLLECTED: 3,
              MARINE_HITS: 0,
              TRAIL_CROSSES: 0,
              FREEZES: 0,
              LAST_X: 12,
              LAST_Y: 0,
              LAST_Z: -4,
            },
          ],
        };
      }
      if (/event_type = 'powerup_collected'/i.test(sql)) {
        return { rows: [{ METADATA_JSON: JSON.stringify({ powerup_type: "powerup_speed" }) }] };
      }
      if (/event_type = 'game_over'/i.test(sql)) return { rows: [{ PRIOR_BEST_SCORE: null }] };
      if (/SELECT id, event_type/i.test(sql)) {
        return {
          rows: [
            {
              ID: 10,
              EVENT_TYPE: "trash_collected",
              OCCURRED_AT: "2026-06-21T15:57:00.000Z",
              SCORE: 1,
              X: 8,
              Y: 0,
              Z: -2,
              RELATED_ITEM_ID: "TR-1",
              METADATA_JSON: JSON.stringify({ item_type: "trash" }),
            },
          ],
        };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) return { rows: [] };
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) return { rows: [] };
      if (/build_script_json/i.test(sql)) {
        return {
          outBinds: {
            result: JSON.stringify({
              ok: true,
              source: "select-ai",
              commentary: "Wojtek cleaned trash while navigating the trail with precision.",
            }),
          },
        };
      }
      return { rows: [] };
    },
  };

  await withEnv({
    INDB_AGENT_ENABLED: "true",
    INDB_AGENT_AUTO_INIT: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MODEL_ROUTE_MODE: "shadow",
    PAF_MODEL_FAST_PATH_ENABLED: "true",
    OCI_BASE_MODEL_ENDPOINT_URL: "https://model.example.test/base",
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      { roomId: "ROOM-LATEST", format: "live_line" },
      {
        oracleConnection,
        oracledb: { BIND_OUT: 3003, STRING: 2001 },
      }
    );

    assert.equal(response.source, "oracle-match-intelligence");
    assert.equal(response.in_db_agent, null);
    assert.equal(response.commentary, "Powerup run: speed boosted a 3 finish.");
    assert.ok(!/trail/i.test(response.commentary));
    assert.match(response.warnings.join("; "), /select-ai:in_db_output_rejected_unsupported_game_fact/);
  });
});

test("does not create replay captions when no replay document exists", async () => {
  const oracleConnection = {
    async execute(sql) {
      if (/FROM STWL_GAME_EVENTS/i.test(sql)) {
        return { rows: [] };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) {
        return { rows: [] };
      }
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  await withEnv({
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
  }, async () => {
    const context = await buildMatchContext(
      {
        summary: {
          session_id: "S-NO-REPLAY",
          player_id: "P-NO-REPLAY",
          player_name: "Ada",
          score: 19,
        },
      },
      { oracleConnection, skipOracleSummary: true }
    );

    assert.equal(context.replay_clips.length, 0);
    assert.equal(context.formats.replay_caption, null);
    assert.equal(context.capabilities.replay_clips, false);
  });
});

test("selects replay caption output only from recorded replay evidence", async () => {
  const oracleConnection = {
    async execute(sql) {
      if (/FROM STWL_GAME_EVENTS/i.test(sql)) {
        return {
          rows: [
            {
              ID: 3,
              EVENT_TYPE: "player_frozen",
              OCCURRED_AT: "2026-06-11T10:00:02.000Z",
              SCORE: 31,
              X: 7,
              Y: 0,
              Z: -2,
              RELATED_PLAYER_ID: "P-RIVAL",
              METADATA_JSON: JSON.stringify({ freeze_ms: 5000 }),
            },
          ],
        };
      }
      if (/FROM STWL_REPLAY_CLIPS/i.test(sql)) {
        return {
          rows: [
            {
              CLIP_ID: "C-FREEZE",
              SESSION_ID: "S-FORMAT",
              PLAYER_ID: "P-FORMAT",
              EVENT_TYPE: "player_frozen",
              TIMECODE_START_MS: -300,
              TIMECODE_END_MS: 1200,
              FRAME_COUNT: 60,
              MODERATION_STATUS: "approved",
            },
          ],
        };
      }
      if (/FROM STWL_AGENT_MEMORIES/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  await withEnv({
    INDB_AGENT_ENABLED: "false",
    PAF_CANVAS_RUN_ENDPOINT_URL: "",
    PAF_ENDPOINT_URL: "",
    PAF_MATCH_INTELLIGENCE_ENABLED: "true",
    PAF_MATCH_INTELLIGENCE_AUTO_INIT: "false",
    PAF_AGENT_MEMORY_PERSIST: "false",
  }, async () => {
    const response = await buildCommentary(
      {
        output_format: "replay_caption",
        summary: {
          session_id: "S-FORMAT",
          player_id: "P-FORMAT",
          player_name: "Grace",
          score: 31,
          freezes: 1,
          trail_crosses: 1,
          last_position: { x: 7, y: 0, z: -2 },
        },
      },
      { oracleConnection, skipOracleSummary: true }
    );

    assert.equal(response.output_format, "replay_caption");
    assert.match(response.commentary, /player_frozen clip/);
    assert.equal(response.evidence.replay_clip_count, 1);
    assert.ok(response.commentary.length <= 200);
  });
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
    assert.match(response.diagnostics.warnings.join("; "), /paf_canvas:paf_canvas_http_503/);
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
  const matchSql = readFileSync(new URL("../../deploy/db/stwl_match_intelligence.sql", import.meta.url), "utf8");
  const learningSql = readFileSync(new URL("../../deploy/db/stwl_model_learning.sql", import.meta.url), "utf8");

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
  assert.match(profileSql, /STWL_EVENT_DOCUMENTS/i);
  assert.match(profileSql, /STWL_GRAPH_VERTICES/i);
  assert.match(profileSql, /STWL_GRAPH_EDGES/i);
  assert.match(profileSql, /STWL_REPLAY_CLIPS/i);
  assert.match(profileSql, /STWL_AGENT_MEMORIES/i);

  assert.match(teamSql, /DBMS_CLOUD_AI_AGENT\.CREATE_TOOL/i);
  assert.match(teamSql, /DBMS_CLOUD_AI_AGENT\.CREATE_AGENT/i);
  assert.match(teamSql, /DBMS_CLOUD_AI_AGENT\.CREATE_TEAM/i);
  assert.match(teamSql, /STWL_GAMEPLAY_COMMENTARY_TEAM/i);
  assert.match(teamSql, /STWL_GAMEPLAY_AI/i);

  assert.match(matchSql, /CREATE TABLE stwl_replay_clips/i);
  assert.match(matchSql, /CREATE TABLE stwl_agent_memories/i);
  assert.match(matchSql, /embedding VECTOR/i);
  assert.match(matchSql, /CREATE OR REPLACE VIEW stwl_event_documents/i);
  assert.match(matchSql, /CREATE OR REPLACE VIEW stwl_graph_vertices/i);
  assert.match(matchSql, /CREATE OR REPLACE VIEW stwl_graph_edges/i);
  assert.match(matchSql, /CREATE PROPERTY GRAPH stwl_gameplay_graph/i);

  assert.match(learningSql, /CREATE TABLE stwl_model_traces/i);
  assert.match(learningSql, /CREATE TABLE stwl_model_outputs/i);
  assert.match(learningSql, /CREATE TABLE stwl_model_evals/i);
  assert.match(learningSql, /CREATE TABLE stwl_training_examples/i);
  assert.match(learningSql, /CREATE TABLE stwl_model_promotions/i);

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
  assert.match(generated, /STWL_REPLAY_CLIPS/i);
  assert.match(generated, /STWL_AGENT_MEMORIES/i);

  const matchInit = matchIntelligenceStatements().join("\n");
  assert.match(matchInit, /CREATE TABLE STWL_REPLAY_CLIPS/i);
  assert.match(matchInit, /CREATE TABLE STWL_AGENT_MEMORIES/i);

  const learningInit = learningTraceStatements().join("\n");
  assert.match(learningInit, /CREATE TABLE STWL_MODEL_TRACES/i);
  assert.match(learningInit, /CREATE TABLE STWL_MODEL_OUTPUTS/i);
  assert.match(learningInit, /CREATE TABLE STWL_MODEL_EVALS/i);
  assert.match(learningInit, /CREATE TABLE STWL_TRAINING_EXAMPLES/i);
  assert.match(learningInit, /CREATE TABLE STWL_MODEL_PROMOTIONS/i);
});

test("training export maps accepted DB trace rows to behavior-only JSONL records", () => {
  const record = rowToTrainingRecord({
    TRACE_ID: "trace-1",
    SESSION_ID: "session-1",
    ROOM_ID: "LOAD-run-5",
    PLAYER_ID: "player-1",
    RUN_ID: "run-1",
    DATASET_VERSION: "stwl-commentary-v1",
    SPLIT: "candidate",
    REDACTION_STATUS: "metadata-only",
    PROMPT_HASH: "prompt-hash",
    EVIDENCE_HASH: "evidence-hash",
    PROMPT_TEXT: "Write one concise commentary line from evidence refs.",
    RUBRIC_VERSION: "stwl-commentary-v1",
    VERDICT: "candidate_ready",
    SCORES_JSON: JSON.stringify({ unique_commentary: 1, confidence_calibrated: 1 }),
    PROVIDER: "oci-fine-tuned",
    MODEL_ID: "ft-adapter-v1",
    OUTPUT_TEXT: "Ada stayed evidence-backed and concise.",
    EXAMPLE_JSON: JSON.stringify({
      citations: ["STWL_MODEL_OUTPUTS:trace-1:oci-fine-tuned"],
      text: "unused fallback",
    }),
  });

  assert.equal(record.trace_id, "trace-1");
  assert.equal(record.prompt_text, "Produce one concise Save the Wildlife commentary line using only Oracle AI Database evidence references.");
  assert.equal(record.prompt_text_redacted, true);
  assert.equal(record.output_text, "Ada stayed evidence-backed and concise.");
  assert.equal(record.provider, "oci-fine-tuned");
  assert.equal(record.eval_scores.unique_commentary, 1);
  assert.ok(record.citations.includes("STWL_GAME_EVENTS:session-1:player-1"));
  assert.ok(record.citations.includes("STWL_MODEL_TRACES:trace-1"));
  assert.ok(record.citations.includes("STWL_MODEL_EVALS:trace-1:stwl-commentary-v1"));
  assert.equal(Object.hasOwn(record, "evidence_json"), false);
});

test("training export CLI parsing keeps accepted-only default and caps limits", () => {
  const parsed = parseTrainingExportArgs([
    "--dataset-version", "v1",
    "--run-id", "run-1",
    "--room", "LOAD-run-100",
    "--include-rejected",
    "--include-prompt-text",
    "--limit", "50000",
    "--output", "/tmp/out.jsonl",
  ]);

  assert.equal(parsed.datasetVersion, "v1");
  assert.equal(parsed.runId, "run-1");
  assert.equal(parsed.roomId, "LOAD-run-100");
  assert.equal(parsed.includeRejected, true);
  assert.equal(parsed.includePromptText, true);
  assert.equal(parsed.limit, 10000);
  assert.equal(parsed.output, "/tmp/out.jsonl");
});
