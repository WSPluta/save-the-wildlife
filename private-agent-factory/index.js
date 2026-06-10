import express from "express";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8080);
const AGENT_NAME = process.env.PAF_AGENT_NAME || "save-the-wildlife-commentator";
const AGENT_MODE = process.env.PAF_AGENT_MODE || "moderated";
const COMMENTARY_MAX_CHARS = Number(process.env.PAF_COMMENTARY_MAX_CHARS || 200);
const ORACLE_QUERY_TIMEOUT_MS = Number(process.env.PAF_ORACLE_QUERY_TIMEOUT_MS || 2000);
const INDB_AGENT_TIMEOUT_MS = Number(process.env.INDB_AGENT_TIMEOUT_MS || 2500);
const INDB_AGENT_PACKAGE = safeIdentifier(process.env.INDB_AGENT_PACKAGE || "STWL_COMMENTARY_PKG");
const GAME_EVENTS_TABLE = safeIdentifier(process.env.GAME_EVENTS_TABLE || "STWL_GAME_EVENTS");
const ORACLE_CONFIG_DIR = process.env.ORACLE_CONFIG_DIR || process.env.TNS_ADMIN || (existsSync("/wallet") ? "/wallet" : "");
const profanityPattern = /\b(fuck|shit|bitch|asshole|bastard|dick|cunt)\b/i;
const DEFAULT_CANVAS_TIMEOUT_MS = 8000;
let inDbPackageInitAttempted = false;
let selectAiInitAttempted = false;

function safeIdentifier(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(id)) {
    throw new Error(`Unsafe Oracle identifier: ${value}`);
  }
  return id;
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textValue(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim();
}

function optionalIdentifier(value) {
  const id = textValue(value);
  return id ? safeIdentifier(id) : "";
}

function sqlLiteral(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function canvasConfig() {
  const verifyTlsValue = textValue(process.env.PAF_CANVAS_VERIFY_TLS || process.env.PAF_VERIFY_TLS || "false").toLowerCase();
  return {
    runEndpointUrl: textValue(process.env.PAF_CANVAS_RUN_ENDPOINT_URL || process.env.PAF_ENDPOINT_URL),
    roomId: textValue(process.env.PAF_CANVAS_ROOM_ID),
    timeoutMs: Number(process.env.PAF_CANVAS_TIMEOUT_MS || process.env.PAF_TIMEOUT_MS || DEFAULT_CANVAS_TIMEOUT_MS),
    verifyTls: ["1", "true", "yes"].includes(verifyTlsValue),
    sessionCookie: textValue(process.env.PAF_CANVAS_SESSION_COOKIE || process.env.PAF_SESSION_COOKIE || process.env.PAF_COOKIE),
    basicUsername: textValue(process.env.PAF_CANVAS_BASIC_USERNAME || process.env.PAF_BASIC_USERNAME),
    basicPassword: textValue(process.env.PAF_CANVAS_BASIC_PASSWORD || process.env.PAF_BASIC_PASSWORD),
  };
}

function inDbAgentConfig() {
  const enabledValue = textValue(process.env.INDB_AGENT_ENABLED || "true").toLowerCase();
  const autoInitValue = textValue(process.env.INDB_AGENT_AUTO_INIT || "true").toLowerCase();
  const selectAiAutoInitValue = textValue(process.env.SELECT_AI_AUTO_INIT || autoInitValue).toLowerCase();
  return {
    enabled: !["0", "false", "no", "off"].includes(enabledValue),
    autoInit: ["1", "true", "yes", "on"].includes(autoInitValue),
    selectAiAutoInit: ["1", "true", "yes", "on"].includes(selectAiAutoInitValue),
    packageName: INDB_AGENT_PACKAGE,
    selectAiProfile: optionalIdentifier(process.env.SELECT_AI_PROFILE || "STWL_GAMEPLAY_AI"),
    agentTeamName: optionalIdentifier(process.env.SELECT_AI_AGENT_TEAM || ""),
    selectAiObjectOwner: optionalIdentifier(process.env.SELECT_AI_OBJECT_OWNER || process.env.ORACLE_USER || "ADMIN"),
    selectAiModel: textValue(process.env.SELECT_AI_MODEL || process.env.OCI_GENAI_MODEL_ID || "cohere.command-r-08-2024"),
    selectAiRegion: textValue(process.env.SELECT_AI_REGION || process.env.OCI_REGION || "uk-london-1"),
    selectAiApiFormat: textValue(process.env.SELECT_AI_OCI_APIFORMAT || "COHERE"),
    timeoutMs: INDB_AGENT_TIMEOUT_MS,
  };
}

function normalizePowerups(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [textValue(key, "powerup"), numberValue(count, 0)])
      .filter(([key, count]) => key && count > 0)
  );
}

function normalizeSummary(value = {}) {
  const summary = value && typeof value === "object" ? value : {};
  const lastPosition = summary.last_position || summary.lastPosition || null;
  return {
    session_id: textValue(summary.session_id || summary.sessionId),
    player_id: textValue(summary.player_id || summary.playerId),
    player_name: textValue(summary.player_name || summary.playerName, "Player"),
    score: numberValue(summary.score, 0),
    trash_collected: numberValue(summary.trash_collected || summary.trashCollected, 0),
    marine_hits: numberValue(summary.marine_hits || summary.marineHits, 0),
    trail_crosses: numberValue(summary.trail_crosses || summary.trailCrosses, 0),
    freezes: numberValue(summary.freezes, 0),
    powerups: normalizePowerups(summary.powerups),
    last_position: lastPosition && typeof lastPosition === "object"
      ? {
          x: numberValue(lastPosition.x, 0),
          y: numberValue(lastPosition.y, 0),
          z: numberValue(lastPosition.z, 0),
        }
      : null,
    prior_best_score: summary.prior_best_score == null && summary.priorBestScore == null
      ? null
      : numberValue(summary.prior_best_score ?? summary.priorBestScore, null),
  };
}

function compactPowerupNames(powerups) {
  return Object.keys(powerups || {})
    .filter(Boolean)
    .map((name) => name.replace(/^powerup_/, ""))
    .slice(0, 3);
}

function historyPhrase(summary) {
  if (summary.prior_best_score == null) return "";
  const delta = summary.score - summary.prior_best_score;
  if (delta >= 0) return `, beating prior best ${summary.prior_best_score}`;
  return `, ${Math.abs(delta)} behind prior best ${summary.prior_best_score}`;
}

function enforceCommentary(value, maxChars = COMMENTARY_MAX_CHARS) {
  let text = textValue(value, "Clean run. SQL telemetry had the final word.");
  if (profanityPattern.test(text)) {
    text = "Strong run. The highlight stays conference-safe.";
  }
  const limit = Math.max(40, Math.min(200, Number(maxChars) || COMMENTARY_MAX_CHARS));
  if (text.length > limit) text = `${text.slice(0, limit - 3).trimEnd()}...`;
  return text;
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function safeCanvasEndpoint(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const runIndex = parts.findIndex((part) => part === "run");
    if (runIndex >= 0 && parts[runIndex + 1]) {
      return `${parsed.protocol}//${parsed.host}/agentFactory/v1/agentBuilder/run/${parts[runIndex + 1]}`;
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch (_) {
    return "<invalid-canvas-endpoint>";
  }
}

function coordinatePhrase(position) {
  if (!position) return "coords=none";
  return `coords=(${Number(position.x).toFixed(1)},${Number(position.y).toFixed(1)},${Number(position.z).toFixed(1)})`;
}

function buildCanvasMessage(summary, options = {}) {
  const powerups = Object.entries(summary.powerups || {})
    .map(([name, count]) => `${name}:${count}`)
    .join(",") || "none";
  const prior = summary.prior_best_score == null ? "none" : String(summary.prior_best_score);
  const inDbDraft = textValue(options.inDbCommentary);
  return [
    "You are the Save the Wildlife conference commentator in Oracle Private Agent Factory Canvas.",
    "Use only this SQL gameplay telemetry and the optional Oracle AI Database draft. Do not invent events, animals, players, or history.",
    "Return one profanity-free commentator line under 200 characters.",
    "Mention powerups, trail crossing/freezing, coordinates, or prior best only when present.",
    inDbDraft ? `oracle_ai_database_draft=${inDbDraft}` : "oracle_ai_database_draft=none",
    `telemetry: session=${summary.session_id || "unknown"}; player=${summary.player_name || summary.player_id || "Player"}; score=${summary.score}; trash=${summary.trash_collected}; marine_hits=${summary.marine_hits}; powerups=${powerups}; trail_crosses=${summary.trail_crosses}; freezes=${summary.freezes}; ${coordinatePhrase(summary.last_position)}; prior_best=${prior}.`,
  ].join("\n");
}

function redactHeaders(headers = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|cookie|token|secret|password/i.test(key)) {
      redacted[key] = "<redacted>";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text || "{}");
  } catch (_) {
    return text;
  }
}

function requestJson(url, { method = "GET", headers = {}, body = null, timeoutMs = DEFAULT_CANVAS_TIMEOUT_MS, verifyTls = false } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      rejectRequest(new Error(`invalid_canvas_url:${error.message}`));
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const requestBody = body == null ? null : Buffer.from(body);
    const started = Date.now();
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          ...headers,
          ...(requestBody ? { "Content-Length": requestBody.length } : {}),
        },
        rejectUnauthorized: parsed.protocol === "https:" ? verifyTls : undefined,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(chunk);
          if (Buffer.concat(chunks).length > 256_000) {
            request.destroy(new Error("canvas_response_too_large"));
          }
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolveRequest({
            status: response.statusCode || 0,
            headers: response.headers,
            payload: parseJsonMaybe(text),
            elapsed_ms: Date.now() - started,
          });
        });
      }
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`canvas_timeout_${timeoutMs}ms`)));
    request.on("error", rejectRequest);
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

async function loginWithBasic(config, requestFn = requestJson) {
  if (!config.basicUsername || !config.basicPassword || !config.runEndpointUrl) {
    return { attempted: false, ok: false, cookie: "" };
  }
  const parsed = new URL(config.runEndpointUrl);
  const loginUrl = `${parsed.protocol}//${parsed.host}/agentFactory/v1/loginValidation`;
  const token = Buffer.from(`${config.basicUsername}:${config.basicPassword}`).toString("base64");
  const response = await requestFn(loginUrl, {
    method: "GET",
    timeoutMs: config.timeoutMs,
    verifyTls: config.verifyTls,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
      "User-Agent": "save-the-wildlife-paf-canvas/1.0",
    },
  });
  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie)
    ? setCookie.map((item) => String(item).split(";")[0]).join("; ")
    : "";
  return {
    attempted: true,
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    cookie,
  };
}

function textFromContent(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) {
    return value.content
      .map((item) => typeof item === "string" ? item : item?.text || item?.content || "")
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value.text === "string") return value.text;
  if (typeof value.message === "string") return value.message;
  return "";
}

function extractCanvasText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const candidates = [
    payload.commentary,
    payload.message,
    payload.answer,
    payload.text,
    payload.output,
    payload.response,
    payload.payload?.commentary,
    payload.payload?.message,
    payload.payload?.answer,
    payload.payload?.text,
    payload.result?.message,
    payload.result?.content,
    payload.data?.message,
    payload.data?.text,
    payload.choices?.[0]?.message?.content,
  ];
  for (const candidate of candidates) {
    const text = textFromContent(candidate);
    if (text) return text;
  }
  if (Array.isArray(payload.messages)) {
    for (const message of payload.messages.slice().reverse()) {
      const text = textFromContent(message);
      if (text) return text;
    }
  }
  return "";
}

async function callPafCanvas(summary, maxChars, options = {}) {
  const config = canvasConfig();
  if (!config.runEndpointUrl) return null;
  const requestFn = options.requestJson || requestJson;

  const login = config.sessionCookie ? { attempted: false, ok: false, cookie: "" } : await loginWithBasic(config, requestFn);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "save-the-wildlife-paf-canvas/1.0",
  };
  const cookie = config.sessionCookie || login.cookie;
  if (cookie) headers.Cookie = cookie;
  if (config.basicUsername && config.basicPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${config.basicUsername}:${config.basicPassword}`).toString("base64")}`;
  }

  const response = await requestFn(config.runEndpointUrl, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    verifyTls: config.verifyTls,
    headers,
    body: JSON.stringify({
      message: buildCanvasMessage(summary, { inDbCommentary: options.inDbCommentary }),
      roomId: config.roomId || null,
    }),
  });

  const location = String(response.headers.location || "");
  const authRequired = [301, 302, 303, 307, 308].includes(response.status) && location.includes("/agentFactory/login");
  if (authRequired || (typeof response.payload === "string" && response.payload.includes("agentFactory/login"))) {
    throw new Error("paf_canvas_auth_required");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`paf_canvas_http_${response.status}`);
  }

  const text = extractCanvasText(response.payload);
  if (!text) throw new Error("paf_canvas_empty_response");

  return {
    commentary: enforceCommentary(text, maxChars),
    room_id: response.payload?.roomId || response.payload?.room_id || null,
    status: response.status,
    elapsed_ms: response.elapsed_ms,
    endpoint: safeCanvasEndpoint(config.runEndpointUrl),
    login: login.attempted ? { attempted: true, ok: login.ok, status: login.status } : { attempted: false },
    request_headers: redactHeaders(headers),
  };
}

function oracleConnectionOptions() {
  if (!process.env.ORACLE_USER || !process.env.ORACLE_PASSWORD || !process.env.ORACLE_CONNECT_STRING) {
    return null;
  }

  const connectionOptions = {
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
  };
  if (ORACLE_CONFIG_DIR) {
    connectionOptions.configDir = ORACLE_CONFIG_DIR;
    connectionOptions.walletLocation = process.env.ORACLE_WALLET_LOCATION || ORACLE_CONFIG_DIR;
  }
  if (process.env.ORACLE_WALLET_PASSWORD) {
    connectionOptions.walletPassword = process.env.ORACLE_WALLET_PASSWORD;
  }
  return connectionOptions;
}

async function loadOracleDriver() {
  try {
    const module = await import("oracledb");
    const oracledb = module.default || module;
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];
    return oracledb;
  } catch (error) {
    throw new Error(`oracledb_unavailable:${error.message}`);
  }
}

const inDbPackageStatements = [
  `CREATE OR REPLACE PACKAGE STWL_COMMENTARY_PKG AUTHID DEFINER AS
  FUNCTION build_script_json(
    p_session_id         IN VARCHAR2,
    p_player_id          IN VARCHAR2,
    p_max_chars          IN NUMBER   DEFAULT 200,
    p_select_ai_profile  IN VARCHAR2 DEFAULT 'STWL_GAMEPLAY_AI',
    p_agent_team_name    IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB;
END STWL_COMMENTARY_PKG;`,
  `CREATE OR REPLACE PACKAGE BODY STWL_COMMENTARY_PKG AS
  FUNCTION clamp_text(p_text IN CLOB, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_text  VARCHAR2(32767) := REGEXP_REPLACE(DBMS_LOB.SUBSTR(NVL(p_text, 'Clean run. SQL telemetry had the final word.'), 32000, 1), '[[:space:]]+', ' ');
    v_limit PLS_INTEGER := LEAST(200, GREATEST(40, NVL(p_max_chars, 200)));
  BEGIN
    IF REGEXP_LIKE(v_text, '(^|[^[:alnum:]_])(fuck|shit|bitch|asshole|bastard|dick|cunt)([^[:alnum:]_]|$)', 'i') THEN
      v_text := 'Strong run. The highlight stays conference-safe.';
    END IF;
    IF LENGTH(v_text) > v_limit THEN
      v_text := RTRIM(SUBSTR(v_text, 1, v_limit - 3)) || '...';
    END IF;
    RETURN v_text;
  END;

  FUNCTION session_summary_json(p_session_id IN VARCHAR2, p_player_id IN VARCHAR2) RETURN CLOB IS
    v_sql     CLOB;
    v_summary CLOB;
  BEGIN
    v_sql := q'[
      WITH params AS (
        SELECT :session_id AS session_id, :player_id AS player_id FROM dual
      ),
      base AS (
        SELECT e.session_id,
               MAX(e.room_id) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS room_id,
               e.player_id,
               MAX(e.player_name) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS player_name,
               NVL(MAX(e.score) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at), 0) AS score,
               SUM(CASE WHEN e.event_type = 'trash_collected' THEN 1 ELSE 0 END) AS trash_collected,
               SUM(CASE WHEN e.event_type = 'marine_hit' THEN 1 ELSE 0 END) AS marine_hits,
               SUM(CASE WHEN e.event_type = 'trail_crossed' THEN 1 ELSE 0 END) AS trail_crosses,
               SUM(CASE WHEN e.event_type = 'player_frozen' THEN 1 ELSE 0 END) AS freezes,
               MAX(e.x) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS last_x,
               MAX(e.y) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS last_y,
               MAX(e.z) KEEP (DENSE_RANK LAST ORDER BY e.occurred_at) AS last_z
          FROM stwl_game_events e
          JOIN params p ON p.session_id = e.session_id AND p.player_id = e.player_id
         GROUP BY e.session_id, e.player_id
      ),
      powerups AS (
        SELECT JSON_OBJECTAGG(KEY powerup_type VALUE cnt RETURNING CLOB) AS powerups_json
          FROM (
            SELECT COALESCE(JSON_VALUE(e.metadata_json, '$.powerup_type'), 'powerup') AS powerup_type,
                   COUNT(*) AS cnt
              FROM stwl_game_events e
              JOIN params p ON p.session_id = e.session_id AND p.player_id = e.player_id
             WHERE e.event_type = 'powerup_collected'
             GROUP BY COALESCE(JSON_VALUE(e.metadata_json, '$.powerup_type'), 'powerup')
          )
      ),
      history AS (
        SELECT MAX(e.score) AS prior_best_score
          FROM stwl_game_events e
          JOIN params p ON p.player_id = e.player_id
         WHERE e.event_type = 'game_over'
           AND e.session_id <> p.session_id
      )
      SELECT JSON_OBJECT(
               'session_id' VALUE b.session_id,
               'room_id' VALUE b.room_id,
               'player_id' VALUE b.player_id,
               'player_name' VALUE NVL(b.player_name, 'Player'),
               'score' VALUE b.score,
               'trash_collected' VALUE b.trash_collected,
               'marine_hits' VALUE b.marine_hits,
               'trail_crosses' VALUE b.trail_crosses,
               'freezes' VALUE b.freezes,
               'powerups' VALUE COALESCE(p.powerups_json, TO_CLOB('{}')) FORMAT JSON,
               'last_position' VALUE JSON_OBJECT('x' VALUE b.last_x, 'y' VALUE b.last_y, 'z' VALUE b.last_z RETURNING CLOB) FORMAT JSON,
               'prior_best_score' VALUE h.prior_best_score
               RETURNING CLOB
             )
        FROM base b
        CROSS JOIN powerups p
        CROSS JOIN history h
    ]';
    EXECUTE IMMEDIATE v_sql INTO v_summary USING p_session_id, p_player_id;
    RETURN v_summary;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RETURN NULL;
  END;

  FUNCTION deterministic_script(p_summary IN CLOB, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_score      NUMBER := NVL(JSON_VALUE(p_summary, '$.score' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_trash      NUMBER := NVL(JSON_VALUE(p_summary, '$.trash_collected' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_hits       NUMBER := NVL(JSON_VALUE(p_summary, '$.marine_hits' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_trails     NUMBER := NVL(JSON_VALUE(p_summary, '$.trail_crosses' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_freezes    NUMBER := NVL(JSON_VALUE(p_summary, '$.freezes' RETURNING NUMBER DEFAULT 0 ON ERROR), 0);
    v_powerups   VARCHAR2(4000) := NVL(JSON_QUERY(p_summary, '$.powerups'), '{}');
    v_prior      VARCHAR2(64) := JSON_VALUE(p_summary, '$.prior_best_score');
  BEGIN
    IF v_freezes > 0 THEN
      RETURN clamp_text('Trail drama: frozen ' || v_freezes || 'x after ' || v_trails || ' crossing(s), finished ' || v_score || '.', p_max_chars);
    ELSIF v_powerups <> '{}' THEN
      RETURN clamp_text('Powerup run: SQL saw boosts on the way to ' || v_score || ' points.', p_max_chars);
    ELSIF v_prior IS NOT NULL THEN
      RETURN clamp_text('Score ' || v_score || ' against prior best ' || v_prior || '. SQL history has the receipts.', p_max_chars);
    ELSIF v_hits > 0 THEN
      RETURN clamp_text(v_score || ' points with ' || v_hits || ' marine hit(s). Fast route, costly contact.', p_max_chars);
    END IF;
    RETURN clamp_text(v_score || ' points and ' || v_trash || ' clean pickups. Smooth telemetry, tidy finish.', p_max_chars);
  END;

  FUNCTION build_prompt(p_summary IN CLOB) RETURN CLOB IS
  BEGIN
    RETURN 'Use only this Save the Wildlife SQL telemetry JSON. Return one profanity-free commentator line under 200 characters. Mention powerups, trail crossings, freezes, coordinates, or prior best only when present. ' || p_summary;
  END;

  FUNCTION select_ai_script(p_summary IN CLOB, p_profile IN VARCHAR2, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_result CLOB;
    v_prompt CLOB := build_prompt(p_summary);
  BEGIN
    IF p_profile IS NULL THEN
      RETURN NULL;
    END IF;
    EXECUTE IMMEDIATE q'[
      BEGIN
        :result := DBMS_CLOUD_AI.GENERATE(
          prompt       => :prompt,
          profile_name => :profile_name,
          action       => 'chat'
        );
      END;]' USING OUT v_result, IN v_prompt, IN p_profile;
    RETURN clamp_text(v_result, p_max_chars);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;

  FUNCTION agent_team_script(p_summary IN CLOB, p_team_name IN VARCHAR2, p_max_chars IN NUMBER) RETURN VARCHAR2 IS
    v_result CLOB;
    v_prompt CLOB := build_prompt(p_summary);
    v_params VARCHAR2(4000);
  BEGIN
    IF p_team_name IS NULL THEN
      RETURN NULL;
    END IF;
    v_params := JSON_OBJECT('conversation_id' VALUE 'stwl-' || RAWTOHEX(SYS_GUID()));
    EXECUTE IMMEDIATE q'[
      BEGIN
        :result := DBMS_CLOUD_AI_AGENT.RUN_TEAM(
          team_name    => :team_name,
          user_prompt  => :prompt,
          params       => :params
        );
      END;]' USING OUT v_result, IN p_team_name, IN v_prompt, IN v_params;
    RETURN clamp_text(v_result, p_max_chars);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;

  FUNCTION build_script_json(
    p_session_id         IN VARCHAR2,
    p_player_id          IN VARCHAR2,
    p_max_chars          IN NUMBER   DEFAULT 200,
    p_select_ai_profile  IN VARCHAR2 DEFAULT 'STWL_GAMEPLAY_AI',
    p_agent_team_name    IN VARCHAR2 DEFAULT NULL
  ) RETURN CLOB IS
    v_summary CLOB;
    v_text    VARCHAR2(4000);
    v_source  VARCHAR2(64) := 'oracle-ai-database-deterministic';
  BEGIN
    v_summary := session_summary_json(p_session_id, p_player_id);
    IF v_summary IS NULL THEN
      RETURN JSON_OBJECT('ok' VALUE 0, 'source' VALUE 'oracle-ai-database', 'error' VALUE 'session_not_found');
    END IF;

    v_text := agent_team_script(v_summary, p_agent_team_name, p_max_chars);
    IF v_text IS NOT NULL THEN
      v_source := 'oracle-ai-database-agent';
    ELSE
      v_text := select_ai_script(v_summary, p_select_ai_profile, p_max_chars);
      IF v_text IS NOT NULL THEN
        v_source := 'select-ai';
      ELSE
        v_text := deterministic_script(v_summary, p_max_chars);
      END IF;
    END IF;

    RETURN JSON_OBJECT(
      'ok' VALUE 1,
      'source' VALUE v_source,
      'commentary' VALUE v_text,
      'summary' VALUE v_summary FORMAT JSON
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN JSON_OBJECT(
        'ok' VALUE 0,
        'source' VALUE 'oracle-ai-database-error',
        'error' VALUE SUBSTR(SQLERRM, 1, 500)
      );
  END;
END STWL_COMMENTARY_PKG;`,
];

function buildSelectAiProfileStatement(config) {
  const attributes = {
    provider: "oci",
    credential_name: "OCI$RESOURCE_PRINCIPAL",
    region: config.selectAiRegion,
    model: config.selectAiModel,
    oci_apiformat: config.selectAiApiFormat,
    object_list: [
      { owner: config.selectAiObjectOwner, name: GAME_EVENTS_TABLE },
      { owner: config.selectAiObjectOwner, name: optionalIdentifier(process.env.GAME_SESSION_SUMMARY_VIEW || "STWL_SESSION_SUMMARY") },
    ],
    comments: true,
    max_tokens: 512,
    temperature: 0,
  };
  return `BEGIN
  EXECUTE IMMEDIATE q'~
    DECLARE
      v_count NUMBER := 0;
    BEGIN
      BEGIN
        DBMS_CLOUD_ADMIN.ENABLE_RESOURCE_PRINCIPAL();
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      BEGIN
        SELECT COUNT(*) INTO v_count
        FROM user_cloud_ai_profiles
        WHERE profile_name = '${sqlLiteral(config.selectAiProfile)}';
      EXCEPTION
        WHEN OTHERS THEN
          v_count := 0;
      END;

      IF v_count = 0 THEN
        DBMS_CLOUD_AI.CREATE_PROFILE(
          profile_name => '${sqlLiteral(config.selectAiProfile)}',
          attributes   => '${sqlLiteral(JSON.stringify(attributes))}'
        );
      END IF;
    END;
  ~';
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;`;
}

function buildSelectAiAgentTeamStatement(config) {
  if (!config.agentTeamName) return null;
  const toolAttributes = {
    tool_type: "SQL",
    description: "Read-only SQL over Save the Wildlife telemetry views scoped by STWL_GAMEPLAY_AI.",
    profile_name: config.selectAiProfile,
  };
  const taskAttributes = {
    description: "Produce one conference-safe Save the Wildlife commentator line under 200 characters from recorded SQL telemetry only.",
    instructions: "Use only provided telemetry or read-only SQL tool results. Mention powerups, trail crossings, freezes, coordinates, or prior best only when present. Never invent events, players, animals, or history.",
    tools: ["STWL_GAMEPLAY_SQL_TOOL"],
  };
  const agentAttributes = {
    description: "Bounded Save the Wildlife in-database commentary agent.",
    profile_name: config.selectAiProfile,
    tasks: ["STWL_COMMENTARY_TASK"],
  };
  const teamAttributes = {
    description: "Save the Wildlife gameplay commentary team.",
    agents: ["STWL_COMMENTARY_AGENT"],
    main_agent: "STWL_COMMENTARY_AGENT",
  };
  return `BEGIN
  EXECUTE IMMEDIATE q'~
    BEGIN
      BEGIN DBMS_CLOUD_AI_AGENT.DROP_TEAM(team_name => '${sqlLiteral(config.agentTeamName)}', force => TRUE); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN DBMS_CLOUD_AI_AGENT.DROP_TASK(task_name => 'STWL_COMMENTARY_TASK', force => TRUE); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN DBMS_CLOUD_AI_AGENT.DROP_TOOL(tool_name => 'STWL_GAMEPLAY_SQL_TOOL', force => TRUE); EXCEPTION WHEN OTHERS THEN NULL; END;
      BEGIN DBMS_CLOUD_AI_AGENT.DROP_AGENT(agent_name => 'STWL_COMMENTARY_AGENT', force => TRUE); EXCEPTION WHEN OTHERS THEN NULL; END;

      DBMS_CLOUD_AI_AGENT.CREATE_TOOL(
        tool_name  => 'STWL_GAMEPLAY_SQL_TOOL',
        attributes => '${sqlLiteral(JSON.stringify(toolAttributes))}'
      );
      DBMS_CLOUD_AI_AGENT.CREATE_TASK(
        task_name  => 'STWL_COMMENTARY_TASK',
        attributes => '${sqlLiteral(JSON.stringify(taskAttributes))}'
      );
      DBMS_CLOUD_AI_AGENT.CREATE_AGENT(
        agent_name => 'STWL_COMMENTARY_AGENT',
        attributes => '${sqlLiteral(JSON.stringify(agentAttributes))}'
      );
      DBMS_CLOUD_AI_AGENT.CREATE_TEAM(
        team_name  => '${sqlLiteral(config.agentTeamName)}',
        attributes => '${sqlLiteral(JSON.stringify(teamAttributes))}'
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  ~';
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;`;
}

function selectAiInitStatements(config) {
  if (!config.selectAiProfile) return [];
  return [
    buildSelectAiProfileStatement(config),
    buildSelectAiAgentTeamStatement(config),
  ].filter(Boolean);
}

async function ensureInDbPackage(connection) {
  const config = inDbAgentConfig();
  if (!config.enabled || !config.autoInit) return;

  if (config.packageName === "STWL_COMMENTARY_PKG" && !inDbPackageInitAttempted) {
    inDbPackageInitAttempted = true;
    for (const statement of inDbPackageStatements) {
      await connection.execute(statement);
    }
  }

  if (config.selectAiAutoInit && !selectAiInitAttempted) {
    selectAiInitAttempted = true;
    for (const statement of selectAiInitStatements(config)) {
      try {
        await connection.execute(statement);
      } catch (_) {
        // Select AI setup is optional at runtime; the deterministic SQL path remains available.
      }
    }
  }
}

async function getOracleConnection(options = {}) {
  if (options.oracleConnection) {
    return { connection: options.oracleConnection, oracledb: options.oracledb || {}, close: false };
  }
  const connectionOptions = oracleConnectionOptions();
  if (!connectionOptions) return null;
  const oracledb = options.oracledb || await loadOracleDriver();
  return {
    connection: await oracledb.getConnection(connectionOptions),
    oracledb,
    close: true,
  };
}

function deterministicScript(summary, maxChars) {
  const powerups = compactPowerupNames(summary.powerups);
  const hist = historyPhrase(summary);
  if (summary.freezes > 0) {
    return enforceCommentary(
      `Trail drama: frozen ${summary.freezes}x after ${summary.trail_crosses} crossing(s), finished ${summary.score}${hist}.`,
      maxChars
    );
  }
  if (powerups.length > 0) {
    return enforceCommentary(
      `Powerup run: ${powerups.join(", ")} boosted a ${summary.score} finish${hist}.`,
      maxChars
    );
  }
  if (summary.prior_best_score != null) {
    return enforceCommentary(
      summary.score >= summary.prior_best_score
        ? `New personal best: ${summary.score}. SQL history confirms the jump.`
        : `${summary.score} this run, ${Math.abs(summary.score - summary.prior_best_score)} off the prior best.`,
      maxChars
    );
  }
  if (summary.marine_hits > 0) {
    return enforceCommentary(
      `${summary.score} points with ${summary.marine_hits} marine hit(s). Fast route, costly contact.`,
      maxChars
    );
  }
  return enforceCommentary(
    `${summary.score} points and ${summary.trash_collected} clean pickups. Smooth telemetry, tidy finish.`,
    maxChars
  );
}

async function getOracleSummary(sessionId, playerId, options = {}) {
  const oracle = await getOracleConnection(options);
  if (!oracle) return null;
  const { connection, close } = oracle;
  try {
    const binds = { sessionId, playerId };
    const summaryResult = await connection.execute(
      `SELECT
        session_id,
        player_id,
        MAX(player_name) KEEP (DENSE_RANK LAST ORDER BY occurred_at) AS player_name,
        NVL(MAX(score) KEEP (DENSE_RANK LAST ORDER BY occurred_at), 0) AS score,
        SUM(CASE WHEN event_type = 'trash_collected' THEN 1 ELSE 0 END) AS trash_collected,
        SUM(CASE WHEN event_type = 'marine_hit' THEN 1 ELSE 0 END) AS marine_hits,
        SUM(CASE WHEN event_type = 'trail_crossed' THEN 1 ELSE 0 END) AS trail_crosses,
        SUM(CASE WHEN event_type = 'player_frozen' THEN 1 ELSE 0 END) AS freezes,
        MAX(x) KEEP (DENSE_RANK LAST ORDER BY occurred_at) AS last_x,
        MAX(y) KEEP (DENSE_RANK LAST ORDER BY occurred_at) AS last_y,
        MAX(z) KEEP (DENSE_RANK LAST ORDER BY occurred_at) AS last_z
      FROM ${GAME_EVENTS_TABLE}
      WHERE session_id = :sessionId AND player_id = :playerId
      GROUP BY session_id, player_id`,
      binds
    );
    const row = summaryResult.rows?.[0];
    if (!row) return null;

    const powerups = {};
    const powerupResult = await connection.execute(
      `SELECT metadata_json
      FROM ${GAME_EVENTS_TABLE}
      WHERE session_id = :sessionId
        AND player_id = :playerId
        AND event_type = 'powerup_collected'
      ORDER BY occurred_at`,
      binds
    );
    for (const powerupRow of powerupResult.rows || []) {
      try {
        const metadata = JSON.parse(powerupRow.METADATA_JSON || "{}");
        const type = textValue(metadata.powerup_type || metadata.powerupType, "powerup");
        powerups[type] = (powerups[type] || 0) + 1;
      } catch (_) {
        powerups.powerup = (powerups.powerup || 0) + 1;
      }
    }

    const priorResult = await connection.execute(
      `SELECT MAX(score) AS prior_best_score
      FROM ${GAME_EVENTS_TABLE}
      WHERE player_id = :playerId
        AND event_type = 'game_over'
        AND session_id <> :sessionId`,
      binds
    );
    const priorBest = priorResult.rows?.[0]?.PRIOR_BEST_SCORE;

    return normalizeSummary({
      session_id: row.SESSION_ID,
      player_id: row.PLAYER_ID,
      player_name: row.PLAYER_NAME,
      score: row.SCORE,
      trash_collected: row.TRASH_COLLECTED,
      marine_hits: row.MARINE_HITS,
      trail_crosses: row.TRAIL_CROSSES,
      freezes: row.FREEZES,
      powerups,
      last_position: row.LAST_X == null && row.LAST_Z == null ? null : {
        x: row.LAST_X,
        y: row.LAST_Y,
        z: row.LAST_Z,
      },
      prior_best_score: priorBest == null ? null : priorBest,
    });
  } finally {
    if (close) await connection.close();
  }
}

async function callInDbAgent(summary, maxChars, options = {}) {
  const config = inDbAgentConfig();
  if (!config.enabled || !summary.session_id || !summary.player_id) return null;
  const oracle = await getOracleConnection(options);
  if (!oracle) return null;
  const { connection, oracledb, close } = oracle;
  try {
    await ensureInDbPackage(connection);
    const result = await connection.execute(
      `BEGIN
        :result := ${config.packageName}.build_script_json(
          p_session_id        => :session_id,
          p_player_id         => :player_id,
          p_max_chars         => :max_chars,
          p_select_ai_profile => :select_ai_profile,
          p_agent_team_name   => :agent_team_name
        );
      END;`,
      {
        result: {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 32767,
        },
        session_id: summary.session_id,
        player_id: summary.player_id,
        max_chars: Math.max(40, Math.min(200, Number(maxChars) || COMMENTARY_MAX_CHARS)),
        select_ai_profile: config.selectAiProfile || null,
        agent_team_name: config.agentTeamName || null,
      }
    );
    const payload = parseJsonMaybe(result.outBinds?.result || "{}");
    if (!payload || typeof payload !== "object") throw new Error("indb_agent_invalid_json");
    if (!payload.ok) throw new Error(`indb_agent_${payload.error || "not_ready"}`);
    const commentary = enforceCommentary(payload.commentary, maxChars);
    return {
      commentary,
      source: textValue(payload.source, "oracle-ai-database-agent"),
      summary: payload.summary && typeof payload.summary === "object" ? normalizeSummary(payload.summary) : null,
    };
  } finally {
    if (close) await connection.close();
  }
}

async function buildCommentary(body = {}, options = {}) {
  const maxChars = Number(body.max_chars || body.maxChars || COMMENTARY_MAX_CHARS);
  const bodySummary = normalizeSummary(body.summary || body);
  let summary = bodySummary;
  let source = "request-summary";
  let warning = null;

  if (!options.skipOracleSummary && bodySummary.session_id && bodySummary.player_id) {
    try {
      const oracleSummary = await withTimeout(
        getOracleSummary(bodySummary.session_id, bodySummary.player_id, options),
        ORACLE_QUERY_TIMEOUT_MS,
        "oracle_summary"
      );
      if (oracleSummary) {
        summary = oracleSummary;
        source = "oracle-sql";
      }
    } catch (error) {
      warning = error.message;
    }
  }

  let inDbAgent = null;
  if (summary.session_id && summary.player_id) {
    try {
      inDbAgent = await withTimeout(
        callInDbAgent(summary, maxChars, options),
        inDbAgentConfig().timeoutMs,
        "indb_agent"
      );
      if (inDbAgent?.summary) summary = inDbAgent.summary;
    } catch (error) {
      warning = [warning, error.message].filter(Boolean).join("; ");
    }
  }

  let canvas = null;
  if (canvasConfig().runEndpointUrl) {
    try {
      canvas = await callPafCanvas(summary, maxChars, { ...options, inDbCommentary: inDbAgent?.commentary });
    } catch (error) {
      warning = [warning, `paf_canvas:${error.message}`].filter(Boolean).join("; ");
    }
  }

  return {
    ok: true,
    commentary: canvas?.commentary || inDbAgent?.commentary || deterministicScript(summary, maxChars),
    source: canvas ? "paf-canvas" : inDbAgent?.source || source,
    fallback_source: canvas ? inDbAgent?.source || source : null,
    warning,
    in_db_agent: inDbAgent ? {
      source: inDbAgent.source,
      configured: true,
    } : null,
    canvas: canvas ? {
      endpoint: canvas.endpoint,
      room_id: canvas.room_id,
      status: canvas.status,
      elapsed_ms: canvas.elapsed_ms,
      login: canvas.login,
    } : null,
    summary,
    agent: {
      name: AGENT_NAME,
      mode: AGENT_MODE,
      genai_model_id: process.env.OCI_GENAI_MODEL_ID || null,
    },
  };
}

app.get("/healthz", (_req, res) => {
  const config = canvasConfig();
  const inDbConfig = inDbAgentConfig();
  res.json({
    ok: true,
    service: "private-agent-factory",
    version: packageJson.version,
    oracle_configured: Boolean(process.env.ORACLE_USER && process.env.ORACLE_PASSWORD && process.env.ORACLE_CONNECT_STRING),
    genai_configured: Boolean(process.env.OCI_REGION && process.env.OCI_COMPARTMENT_OCID && process.env.OCI_GENAI_MODEL_ID),
    canvas_configured: Boolean(config.runEndpointUrl),
    canvas_endpoint: safeCanvasEndpoint(config.runEndpointUrl),
    canvas_auth_configured: Boolean(config.sessionCookie || (config.basicUsername && config.basicPassword)),
    indb_agent_enabled: inDbConfig.enabled,
    indb_agent_package: inDbConfig.packageName,
    select_ai_auto_init: inDbConfig.selectAiAutoInit,
    select_ai_profile: inDbConfig.selectAiProfile,
    select_ai_region: inDbConfig.selectAiRegion,
    select_ai_model: inDbConfig.selectAiModel,
    select_ai_agent_team_configured: Boolean(inDbConfig.agentTeamName),
  });
});

app.get("/api/commentary", async (req, res) => {
  try {
    res.json(await buildCommentary(req.query));
  } catch (error) {
    res.status(500).json({ ok: false, error: "commentary_failed", detail: error.message });
  }
});

app.post("/api/commentary", async (req, res) => {
  try {
    res.json(await buildCommentary(req.body));
  } catch (error) {
    res.status(500).json({ ok: false, error: "commentary_failed", detail: error.message });
  }
});

function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`${AGENT_NAME} listening on ${PORT}`);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (process.env.PAF_DISABLE_SERVER !== "1" && isMain) {
  startServer();
}

export {
  app,
  buildCanvasMessage,
  buildCommentary,
  callPafCanvas,
  callInDbAgent,
  canvasConfig,
  deterministicScript,
  inDbAgentConfig,
  inDbPackageStatements,
  selectAiInitStatements,
  enforceCommentary,
  extractCanvasText,
  normalizeSummary,
  safeCanvasEndpoint,
  startServer,
};
