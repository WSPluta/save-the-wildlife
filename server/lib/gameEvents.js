import fetch from "node-fetch";

export const GAME_EVENT_TYPES = new Set([
  "game_started",
  "position_sample",
  "trash_collected",
  "marine_hit",
  "powerup_collected",
  "trail_crossed",
  "player_frozen",
  "game_over",
]);

const MAX_LOCAL_EVENTS = parseInt(process.env.GAME_EVENTS_LOCAL_LIMIT ?? "5000", 10);
const POSITION_SAMPLE_MIN_MS = parseInt(process.env.GAME_EVENTS_POSITION_SAMPLE_MIN_MS ?? "1000", 10);
const COMMENTARY_MAX_CHARS = parseInt(process.env.COMMENTARY_MAX_CHARS ?? "200", 10);
const PAF_AGENT_BASE_URL = (process.env.PAF_AGENT_BASE_URL || "").replace(/\/+$/, "");
const PAF_AGENT_TIMEOUT_MS = parseInt(process.env.PAF_AGENT_TIMEOUT_MS ?? "2500", 10);
const GAME_EVENTS_SERVICE_BASE_URL = (process.env.GAME_EVENTS_SERVICE_BASE_URL || "").replace(/\/+$/, "");
const profanityPattern = /\b(fuck|shit|bitch|asshole|bastard|dick|cunt)\b/i;

const localEvents = [];
const lastPositionSampleByPlayer = new Map();
let oracleState = { attempted: false, ready: false, oracledb: null, connection: null };

function asString(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).trim();
}

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePosition(payload = {}) {
  const source = payload.position || payload.coordinates || payload.worldPos || {};
  const x = finiteNumber(source.x ?? payload.x);
  const y = finiteNumber(source.y ?? payload.y, 0);
  const z = finiteNumber(source.z ?? payload.z);
  if (x == null && z == null) return null;
  return {
    x: x ?? 0,
    y,
    z: z ?? 0,
  };
}

function trimMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const copy = { ...metadata };
  const encoded = JSON.stringify(copy);
  if (encoded.length <= 4000) return copy;
  return { truncated: true, preview: encoded.slice(0, 3800) };
}

export function normalizeGameEvent(payload = {}, context = {}) {
  const eventType = asString(payload.event_type || payload.eventType || payload.type);
  if (!GAME_EVENT_TYPES.has(eventType)) {
    throw new Error(`unsupported_event_type:${eventType || "missing"}`);
  }

  const playerId = asString(payload.player_id || payload.playerId || context.playerId);
  if (!playerId) throw new Error("missing_player_id");

  const roomId = asString(payload.room_id || payload.roomId || context.roomId || "GLOBAL");
  const sessionId = asString(
    payload.session_id || payload.sessionId || context.sessionId || `${roomId}:${playerId}`
  );
  const position = normalizePosition(payload);
  const now = new Date();
  const occurredAt = payload.occurred_at || payload.occurredAt || payload.timestamp || now.toISOString();

  return {
    event_type: eventType,
    session_id: sessionId,
    room_id: roomId,
    player_id: playerId,
    player_name: asString(payload.player_name || payload.playerName || context.playerName, "Player"),
    occurred_at: new Date(occurredAt).toString() === "Invalid Date" ? now.toISOString() : new Date(occurredAt).toISOString(),
    score: finiteNumber(payload.score ?? payload.localScore, 0),
    x: position ? position.x : null,
    y: position ? position.y : null,
    z: position ? position.z : null,
    related_player_id: asString(payload.related_player_id || payload.relatedPlayerId),
    related_item_id: asString(payload.related_item_id || payload.relatedItemId || payload.itemId),
    metadata: trimMetadata({
      ...(payload.metadata || {}),
      powerup_type: payload.powerup_type || payload.powerupType,
      item_type: payload.item_type || payload.itemType,
      freeze_ms: payload.freeze_ms || payload.freezeMs,
    }),
  };
}

function shouldDropSample(event) {
  if (event.event_type !== "position_sample") return false;
  const key = `${event.session_id}:${event.player_id}`;
  const now = Date.now();
  const prev = lastPositionSampleByPlayer.get(key) || 0;
  if (now - prev < POSITION_SAMPLE_MIN_MS) return true;
  lastPositionSampleByPlayer.set(key, now);
  return false;
}

function rememberLocal(event) {
  localEvents.push(event);
  if (localEvents.length > MAX_LOCAL_EVENTS) {
    localEvents.splice(0, localEvents.length - MAX_LOCAL_EVENTS);
  }
}

async function getOracleConnection() {
  if (oracleState.ready && oracleState.connection) return oracleState.connection;
  if (oracleState.attempted) return null;
  oracleState.attempted = true;

  const enabled = process.env.GAME_EVENTS_DB_ENABLED === "true";
  const user = process.env.GAME_EVENTS_DB_USER || process.env.ORACLE_USER;
  const password = process.env.GAME_EVENTS_DB_PASSWORD || process.env.ORACLE_PASSWORD;
  const connectString = process.env.GAME_EVENTS_DB_CONNECT_STRING || process.env.ORACLE_CONNECT_STRING;
  if (!enabled || !user || !password || !connectString) return null;

  try {
    const oracledb = await import("oracledb");
    oracleState.oracledb = oracledb.default || oracledb;
    oracleState.connection = await oracleState.oracledb.getConnection({ user, password, connectString });
    oracleState.ready = true;
    if (process.env.GAME_EVENTS_AUTO_INIT === "true") {
      await ensureOracleSchema(oracleState.connection);
    }
    return oracleState.connection;
  } catch (error) {
    oracleState.ready = false;
    oracleState.error = error;
    return null;
  }
}

async function ensureOracleSchema(connection) {
  const executeIgnoring = async (sql, ignored = []) => {
    try {
      await connection.execute(sql);
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (!ignored.some((code) => message.includes(code))) throw error;
    }
  };

  const ddl = `CREATE TABLE stwl_game_events (
    id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    session_id VARCHAR2(128) NOT NULL,
    room_id VARCHAR2(64) NOT NULL,
    player_id VARCHAR2(128) NOT NULL,
    player_name VARCHAR2(256),
    event_type VARCHAR2(40) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    score NUMBER,
    x NUMBER,
    y NUMBER,
    z NUMBER,
    related_player_id VARCHAR2(128),
    related_item_id VARCHAR2(128),
    metadata_json CLOB CHECK (metadata_json IS JSON)
  )`;
  try {
    await connection.execute(ddl);
  } catch (error) {
    if (!String(error && error.message).includes("ORA-00955")) throw error;
  }
  await executeIgnoring("CREATE INDEX stwl_game_events_session_ix ON stwl_game_events (session_id, occurred_at)", ["ORA-00955"]);
  await executeIgnoring("CREATE INDEX stwl_game_events_player_ix ON stwl_game_events (player_id, occurred_at)", ["ORA-00955"]);
  await executeIgnoring("CREATE INDEX stwl_game_events_type_ix ON stwl_game_events (event_type, occurred_at)", ["ORA-00955"]);
  await executeIgnoring(`DECLARE
    v_count NUMBER := 0;
    v_start NUMBER := 1;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM user_sequences WHERE sequence_name = 'STWL_GAME_EVENTS_SEQ';
    IF v_count = 0 THEN
      SELECT NVL(MAX(id), 0) + 1 INTO v_start FROM stwl_game_events;
      EXECUTE IMMEDIATE 'CREATE SEQUENCE stwl_game_events_seq START WITH ' || v_start || ' INCREMENT BY 1 NOCACHE';
    END IF;
  END;`);
  await executeIgnoring(`CREATE OR REPLACE VIEW stwl_session_summary AS
    SELECT
      session_id,
      room_id,
      player_id,
      MAX(player_name) AS player_name,
      MIN(occurred_at) AS started_at,
      MAX(occurred_at) AS ended_at,
      MAX(score) KEEP (DENSE_RANK LAST ORDER BY occurred_at) AS final_score,
      SUM(CASE WHEN event_type = 'trash_collected' THEN 1 ELSE 0 END) AS trash_collected,
      SUM(CASE WHEN event_type = 'marine_hit' THEN 1 ELSE 0 END) AS marine_hits,
      SUM(CASE WHEN event_type = 'powerup_collected' THEN 1 ELSE 0 END) AS powerups_collected,
      SUM(CASE WHEN event_type = 'trail_crossed' THEN 1 ELSE 0 END) AS trail_crosses,
      SUM(CASE WHEN event_type = 'player_frozen' THEN 1 ELSE 0 END) AS freezes
    FROM stwl_game_events
    GROUP BY session_id, room_id, player_id`);
  await executeIgnoring("COMMENT ON TABLE stwl_game_events IS 'Save the Wildlife gameplay timeline used by Oracle Private Agent Factory and Select AI demos.'");
  await executeIgnoring("COMMENT ON VIEW stwl_session_summary IS 'Derived per-session gameplay summary for deterministic commentary prompts and Select AI demos.'");
}

async function persistOracle(event) {
  const connection = await getOracleConnection();
  if (!connection) return false;
  await connection.execute(
    `INSERT INTO stwl_game_events (
      id, session_id, room_id, player_id, player_name, event_type, occurred_at,
      score, x, y, z, related_player_id, related_item_id, metadata_json
    ) VALUES (
      stwl_game_events_seq.NEXTVAL,
      :session_id, :room_id, :player_id, :player_name, :event_type,
      TO_TIMESTAMP_TZ(:occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'),
      :score, :x, :y, :z, :related_player_id, :related_item_id, :metadata_json
    )`,
    {
      ...event,
      metadata_json: JSON.stringify(event.metadata || {}),
    },
    { autoCommit: true }
  );
  return true;
}

async function persistService(event) {
  if (!GAME_EVENTS_SERVICE_BASE_URL) return false;
  const response = await fetch(`${GAME_EVENTS_SERVICE_BASE_URL}/api/game-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`game_events_service_http_${response.status}:${body.slice(0, 200)}`);
  }
  return true;
}

export async function recordGameEvent(payload, context = {}) {
  const event = normalizeGameEvent(payload, context);
  if (shouldDropSample(event)) return { ok: true, skipped: true, event };
  rememberLocal(event);
  let persisted = false;
  try {
    persisted = await persistService(event);
    if (!persisted) persisted = await persistOracle(event);
  } catch (error) {
    return { ok: true, persisted: false, event, warning: error.message };
  }
  return { ok: true, persisted, event };
}

export function summarizeSession(sessionId, playerId) {
  const events = localEvents.filter((event) => {
    if (sessionId && event.session_id !== sessionId) return false;
    if (playerId && event.player_id !== playerId) return false;
    return true;
  });
  const summary = {
    session_id: sessionId,
    player_id: playerId,
    player_name: "Player",
    score: 0,
    trash_collected: 0,
    marine_hits: 0,
    trail_crosses: 0,
    freezes: 0,
    powerups: {},
    last_position: null,
    prior_best_score: null,
  };
  for (const event of events) {
    if (event.player_name && event.player_name !== "Player") summary.player_name = event.player_name;
    summary.score = Number.isFinite(event.score) ? event.score : summary.score;
    if (event.x != null && event.z != null) summary.last_position = { x: event.x, y: event.y, z: event.z };
    if (event.event_type === "trash_collected") summary.trash_collected++;
    if (event.event_type === "marine_hit") summary.marine_hits++;
    if (event.event_type === "trail_crossed") summary.trail_crosses++;
    if (event.event_type === "player_frozen") summary.freezes++;
    if (event.event_type === "powerup_collected") {
      const type = event.metadata?.powerup_type || "powerup";
      summary.powerups[type] = (summary.powerups[type] || 0) + 1;
    }
  }
  const priorScores = localEvents
    .filter((event) => event.player_id === playerId && event.event_type === "game_over" && event.session_id !== sessionId)
    .map((event) => Number(event.score))
    .filter(Number.isFinite);
  if (priorScores.length) summary.prior_best_score = Math.max(...priorScores);
  return summary;
}

function enforceCommentary(text) {
  let safe = asString(text, "Clean run. The ocean noticed.");
  if (profanityPattern.test(safe)) safe = "Strong run. The highlight reel stays conference-safe.";
  if (safe.length > COMMENTARY_MAX_CHARS) safe = safe.slice(0, COMMENTARY_MAX_CHARS - 1).trimEnd() + "…";
  return safe;
}

export function deterministicCommentary(summary) {
  const powerups = Object.keys(summary.powerups || {});
  if (summary.freezes > 0) {
    return enforceCommentary(`Frozen ${summary.freezes}x by rival trails, still finished with ${summary.score}. That is stubborn navigation.`);
  }
  if (powerups.length) {
    return enforceCommentary(`Used ${powerups.join(", ")} and closed on ${summary.score}. Tactical boating, not just button mashing.`);
  }
  if (summary.prior_best_score != null) {
    const delta = summary.score - summary.prior_best_score;
    return enforceCommentary(delta >= 0
      ? `New personal best: ${summary.score}. The comeback arc just got a scoreboard.`
      : `${summary.score} this run, ${Math.abs(delta)} behind your best. The rematch has a plot.`);
  }
  if (summary.marine_hits > 0) {
    return enforceCommentary(`${summary.score} points, but ${summary.marine_hits} wildlife bumps. Fast hands, questionable steering.`);
  }
  return enforceCommentary(`${summary.score} points and ${summary.trash_collected} clean pickups. Calm water, clean work.`);
}

async function requestPafCommentary(summary) {
  if (!PAF_AGENT_BASE_URL) return null;
  try {
    const response = await fetch(`${PAF_AGENT_BASE_URL}/api/commentary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ summary, max_chars: COMMENTARY_MAX_CHARS }),
      signal: AbortSignal.timeout(PAF_AGENT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.commentary || body.script || body.text || null;
  } catch (_) {
    return null;
  }
}

export async function buildCommentary(sessionId, playerId) {
  const summary = summarizeSession(sessionId, playerId);
  const pafText = await requestPafCommentary(summary);
  return {
    summary,
    commentary: enforceCommentary(pafText || deterministicCommentary(summary)),
    source: pafText ? "oracle-private-agent-factory" : "deterministic-fallback",
  };
}

export function getLocalEvents() {
  return [...localEvents];
}

export function __resetGameEventsForTests() {
  localEvents.length = 0;
  lastPositionSampleByPlayer.clear();
  oracleState = { attempted: false, ready: false, oracledb: null, connection: null };
}

export function __setOracleConnectionForTests(connection) {
  oracleState = {
    attempted: true,
    ready: Boolean(connection),
    oracledb: null,
    connection,
  };
}
