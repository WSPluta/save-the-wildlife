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
const GAME_EVENTS_TABLE = safeIdentifier(process.env.GAME_EVENTS_TABLE || "STWL_GAME_EVENTS");
const ORACLE_CONFIG_DIR = process.env.ORACLE_CONFIG_DIR || process.env.TNS_ADMIN || (existsSync("/wallet") ? "/wallet" : "");
const profanityPattern = /\b(fuck|shit|bitch|asshole|bastard|dick|cunt)\b/i;
const DEFAULT_CANVAS_TIMEOUT_MS = 8000;

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

function buildCanvasMessage(summary) {
  const powerups = Object.entries(summary.powerups || {})
    .map(([name, count]) => `${name}:${count}`)
    .join(",") || "none";
  const prior = summary.prior_best_score == null ? "none" : String(summary.prior_best_score);
  return [
    "You are the Save the Wildlife conference commentator in Oracle Private Agent Factory Canvas.",
    "Use only this SQL gameplay telemetry. Do not invent events, animals, players, or history.",
    "Return one profanity-free commentator line under 200 characters.",
    "Mention powerups, trail crossing/freezing, coordinates, or prior best only when present.",
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
      message: buildCanvasMessage(summary),
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

async function getOracleSummary(sessionId, playerId) {
  if (!process.env.ORACLE_USER || !process.env.ORACLE_PASSWORD || !process.env.ORACLE_CONNECT_STRING) {
    return null;
  }

  let oracledb;
  try {
    const module = await import("oracledb");
    oracledb = module.default || module;
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];
  } catch (error) {
    throw new Error(`oracledb_unavailable:${error.message}`);
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

  const connection = await oracledb.getConnection(connectionOptions);
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
    await connection.close();
  }
}

async function buildCommentary(body = {}, options = {}) {
  const maxChars = Number(body.max_chars || body.maxChars || COMMENTARY_MAX_CHARS);
  const bodySummary = normalizeSummary(body.summary || body);
  let summary = bodySummary;
  let source = "request-summary";
  let warning = null;

  if (bodySummary.session_id && bodySummary.player_id) {
    try {
      const oracleSummary = await withTimeout(
        getOracleSummary(bodySummary.session_id, bodySummary.player_id),
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

  let canvas = null;
  if (canvasConfig().runEndpointUrl) {
    try {
      canvas = await callPafCanvas(summary, maxChars, options);
    } catch (error) {
      warning = [warning, `paf_canvas:${error.message}`].filter(Boolean).join("; ");
    }
  }

  return {
    ok: true,
    commentary: canvas?.commentary || deterministicScript(summary, maxChars),
    source: canvas ? "paf-canvas" : source,
    fallback_source: canvas ? source : null,
    warning,
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
  res.json({
    ok: true,
    service: "private-agent-factory",
    version: packageJson.version,
    oracle_configured: Boolean(process.env.ORACLE_USER && process.env.ORACLE_PASSWORD && process.env.ORACLE_CONNECT_STRING),
    genai_configured: Boolean(process.env.OCI_REGION && process.env.OCI_COMPARTMENT_OCID && process.env.OCI_GENAI_MODEL_ID),
    canvas_configured: Boolean(config.runEndpointUrl),
    canvas_endpoint: safeCanvasEndpoint(config.runEndpointUrl),
    canvas_auth_configured: Boolean(config.sessionCookie || (config.basicUsername && config.basicPassword)),
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
  canvasConfig,
  deterministicScript,
  enforceCommentary,
  extractCanvasText,
  normalizeSummary,
  safeCanvasEndpoint,
  startServer,
};
