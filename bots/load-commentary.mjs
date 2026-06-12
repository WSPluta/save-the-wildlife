import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const BOTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BOTS_DIR, "..");
const DEFAULT_TIERS = [5, 10, 50, 100, 500, 1000];
const DEFAULT_COMMENTARY_TIMEOUT_MS = 10_000;
const DEFAULT_JOIN_TIMEOUT_MS = 10_000;
const DEFAULT_EVENT_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_SCORE_TIMEOUT_MS = 10_000;
const DEFAULT_JOIN_EMIT_DELAY_MS = 250;
const DEFAULT_NAMESPACE = "default";
const DEFAULT_SOCKET_PATH = "/socket.io";
const DEFAULT_LOCAL_TARGET = "http://localhost:3000";
const DEFAULT_DISALLOWED_SOURCES = ["deterministic-fallback"];
const COMMENTARY_SAMPLE_LIMIT = 8;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInt(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}_must_be_positive_integer`);
  }
  return parsed;
}

function positiveNumber(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const parsed = Number(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label}_must_be_positive_number`);
  }
  return parsed;
}

function optionalPositiveNumber(value, label) {
  if (value == null || value === "") return null;
  return positiveNumber(value, null, label);
}

function boolValue(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseTiers(value = "") {
  const raw = csv(value);
  if (!raw.length) return [...DEFAULT_TIERS];
  const tiers = raw.map((item) => {
    const parsed = Number.parseInt(item, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`invalid_load_tier:${item}`);
    }
    return parsed;
  });
  return [...new Set(tiers)];
}

export function normalizeCommentaryText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function findDuplicateCommentary(players = []) {
  const byText = new Map();
  for (const player of players) {
    const normalized = normalizeCommentaryText(player.commentary?.text);
    if (!normalized) continue;
    if (!byText.has(normalized)) byText.set(normalized, []);
    byText.get(normalized).push(player.id);
  }
  return [...byText.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([text, ids]) => ({ text, count: ids.length, playerIds: ids }));
}

export function percentile(values = [], p = 95) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const index = Math.ceil((p / 100) * nums.length) - 1;
  return nums[Math.max(0, Math.min(nums.length - 1, index))];
}

export function deriveSocketTarget({ baseUrl, wsUrl, socketPath = DEFAULT_SOCKET_PATH } = {}) {
  const raw = String(wsUrl || baseUrl || DEFAULT_LOCAL_TARGET).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(`invalid_load_target:${error.message}`);
  }

  let pathName = socketPath || DEFAULT_SOCKET_PATH;
  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname.endsWith("/socket.io")) {
    pathName = parsed.pathname;
    parsed.pathname = "/";
  }

  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";

  parsed.pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";

  return {
    url: parsed.toString().replace(/\/$/, ""),
    path: pathName.startsWith("/") ? pathName : `/${pathName}`,
  };
}

export function deriveServiceBaseUrl(value = DEFAULT_LOCAL_TARGET) {
  const raw = String(value || DEFAULT_LOCAL_TARGET).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(`invalid_service_base_url:${error.message}`);
  }

  if (parsed.protocol === "ws:") parsed.protocol = "http:";
  if (parsed.protocol === "wss:") parsed.protocol = "https:";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname
    .replace(/\/socket\.io\/?$/i, "")
    .replace(/\/api\/?$/i, "")
    .replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function defaultRampPerSecond(tier) {
  if (tier <= 10) return 5;
  if (tier <= 50) return 10;
  if (tier <= 100) return 20;
  if (tier <= 500) return 50;
  return 75;
}

function defaultCommentaryConcurrency(tier, rampPerSecond) {
  if (tier <= 10) return 5;
  if (tier <= 50) return 10;
  if (tier <= 100) return 20;
  return Math.min(100, Math.max(25, Math.round(rampPerSecond * 1.5)));
}

export function planTier(tier, config = {}) {
  const rampPerSecond = config.rampPerSecond || defaultRampPerSecond(tier);
  return {
    tier,
    room: buildRoomName(config.runId || "LOCALRUN", tier),
    rampPerSecond,
    joinDelayMs: Math.max(0, Math.round(1000 / rampPerSecond)),
    commentaryConcurrency:
      config.commentaryConcurrency || defaultCommentaryConcurrency(tier, rampPerSecond),
  };
}

export function buildRoomName(runId, tier) {
  const tierPart = String(tier).replace(/[^0-9]/g, "");
  const normalizedRun = String(runId || "RUN")
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, "")
    .slice(0, 16) || "RUN";
  const maxRunLen = Math.max(3, 24 - "LOAD".length - tierPart.length - 2);
  return `LOAD-${normalizedRun.slice(0, maxRunLen)}-${tierPart}`.slice(0, 24);
}

function compactRunId(date = new Date()) {
  return date
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 12);
}

function parseArgs(argv = []) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const [key, inlineValue] = item.slice(2).split("=");
    if (inlineValue != null) {
      args[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args[key] = argv[++i];
    } else {
      args[key] = "true";
    }
  }
  return args;
}

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const runId = String(args["run-id"] || env.STWL_LOAD_RUN_ID || compactRunId()).trim();
  const socketTarget = deriveSocketTarget({
    baseUrl: args["base-url"] || env.STWL_LOAD_BASE_URL,
    wsUrl: args["ws-url"] || env.STWL_LOAD_WS_URL,
    socketPath: args["socket-path"] || env.STWL_LOAD_SOCKET_PATH || DEFAULT_SOCKET_PATH,
  });
  const outputDir = path.resolve(
    REPO_ROOT,
    args["output-dir"] || env.STWL_LOAD_OUTPUT_DIR || path.join("output", "prod-load")
  );
  const rampPerSecond = optionalPositiveNumber(
    args["ramp-per-second"] || env.STWL_LOAD_RAMP_PER_SECOND,
    "stwl_load_ramp_per_second"
  );
  const commentaryConcurrency = optionalPositiveNumber(
    args["commentary-concurrency"] || env.STWL_LOAD_COMMENTARY_CONCURRENCY,
    "stwl_load_commentary_concurrency"
  );
  const scoreBaseUrl = deriveServiceBaseUrl(
    args["score-base-url"] ||
      env.STWL_LOAD_SCORE_BASE_URL ||
      args["base-url"] ||
      env.STWL_LOAD_BASE_URL ||
      args["ws-url"] ||
      env.STWL_LOAD_WS_URL ||
      socketTarget.url
  );
  const disallowedSources = csv(env.STWL_LOAD_DISALLOWED_SOURCES || DEFAULT_DISALLOWED_SOURCES.join(","));

  return {
    runId,
    tiers: parseTiers(args.tiers || env.STWL_LOAD_TIERS),
    outputDir,
    socketUrl: socketTarget.url,
    socketPath: socketTarget.path,
    scoreBaseUrl,
    transports: csv(env.STWL_LOAD_TRANSPORTS || "websocket"),
    adminToken: args["admin-token"] || env.STWL_LOAD_ADMIN_TOKEN || "",
    commentaryTimeoutMs: positiveInt(
      args["commentary-timeout-ms"] || env.STWL_LOAD_COMMENTARY_TIMEOUT_MS,
      DEFAULT_COMMENTARY_TIMEOUT_MS,
      "stwl_load_commentary_timeout_ms"
    ),
    joinTimeoutMs: positiveInt(
      env.STWL_LOAD_JOIN_TIMEOUT_MS,
      DEFAULT_JOIN_TIMEOUT_MS,
      "stwl_load_join_timeout_ms"
    ),
    joinEmitDelayMs: positiveInt(
      env.STWL_LOAD_JOIN_EMIT_DELAY_MS,
      DEFAULT_JOIN_EMIT_DELAY_MS,
      "stwl_load_join_emit_delay_ms"
    ),
    eventAckTimeoutMs: positiveInt(
      env.STWL_LOAD_EVENT_ACK_TIMEOUT_MS,
      DEFAULT_EVENT_ACK_TIMEOUT_MS,
      "stwl_load_event_ack_timeout_ms"
    ),
    adminAckTimeoutMs: positiveInt(
      env.STWL_LOAD_ADMIN_ACK_TIMEOUT_MS,
      DEFAULT_EVENT_ACK_TIMEOUT_MS,
      "stwl_load_admin_ack_timeout_ms"
    ),
    connectionTimeoutMs: positiveInt(
      env.STWL_LOAD_CONNECT_TIMEOUT_MS,
      DEFAULT_JOIN_TIMEOUT_MS,
      "stwl_load_connect_timeout_ms"
    ),
    scoreTimeoutMs: positiveInt(
      args["score-timeout-ms"] || env.STWL_LOAD_SCORE_TIMEOUT_MS,
      DEFAULT_SCORE_TIMEOUT_MS,
      "stwl_load_score_timeout_ms"
    ),
    scoreIncrements: positiveInt(
      args["score-increments"] || env.STWL_LOAD_SCORE_INCREMENTS,
      1,
      "stwl_load_score_increments"
    ),
    joinFailureThreshold: positiveNumber(
      env.STWL_LOAD_JOIN_FAILURE_THRESHOLD,
      0.01,
      "stwl_load_join_failure_threshold"
    ),
    rampPerSecond,
    commentaryConcurrency,
    namespace: env.STWL_LOAD_K8S_NAMESPACE || DEFAULT_NAMESPACE,
    captureK8s: boolValue(env.STWL_LOAD_CAPTURE_K8S, true),
    requireFullPath: boolValue(env.STWL_LOAD_REQUIRE_FULL_PATH, true),
    requireScoreRows: boolValue(env.STWL_LOAD_REQUIRE_SCORE_ROWS, true),
    disallowedSources,
  };
}

function joinFailureReason(tierReport, config = {}) {
  const attempted = tierReport.attempted || 0;
  if (!attempted) return null;
  const joined = (tierReport.players || []).filter((player) => player.joined).length;
  const failures = attempted - joined;
  if (failures / attempted <= (config.joinFailureThreshold ?? 0.01)) return null;
  return `join_failures_above_threshold:${failures}/${attempted}`;
}

function socketOptions(config) {
  return {
    path: config.socketPath,
    transports: config.transports,
    timeout: config.connectionTimeoutMs,
    reconnection: false,
    forceNew: true,
  };
}

function emitWithAck(socket, eventName, payload = {}, timeoutMs = DEFAULT_EVENT_ACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(eventName, payload, (error, response) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(response || {});
    });
  });
}

function connectPlayer({ index, tier, room, config }) {
  const id = `load-${config.runId}-${tier}-${index}`;
  const name = `Load Player ${tier}-${index}`;
  const player = {
    id,
    name,
    index,
    tier,
    room,
    sessionId: `${room}:${id}:${config.runId}`,
    connected: false,
    joined: false,
    errors: [],
    commentary: null,
  };
  const socket = io(config.socketUrl, socketOptions(config));
  player.socket = socket;

  return new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      player.errors.push(`join_timeout_${config.joinTimeoutMs}ms`);
      closeSocket(socket);
      resolve(player);
    }, config.joinTimeoutMs);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      player.joinLatencyMs = Date.now() - startedAt;
      resolve(player);
    };

    socket.once("connect", () => {
      player.connected = true;
      player.connectedAt = nowIso();
      setTimeout(() => {
        if (settled || !socket.connected) return;
        socket.emit("room.join", { id: room });
      }, config.joinEmitDelayMs);
    });

    socket.once("room.joined", (body = {}) => {
      player.joined = body.id === room;
      if (!player.joined) player.errors.push(`joined_wrong_room:${body.id || "missing"}`);
      if (player.joined && socket.connected) {
        socket.emit("player.info.joining", { id, name, room });
      }
      finish();
    });

    socket.once("connect_error", (error) => {
      player.errors.push(`connect_error:${error && error.message ? error.message : String(error)}`);
      finish();
    });

    socket.once("disconnect", (reason) => {
      if (!settled) {
        player.errors.push(`disconnect_before_join:${reason}`);
        finish();
      }
    });
  });
}

async function connectAdmin({ room, config }) {
  const socket = io(config.socketUrl, socketOptions(config));
  const adminId = `load-admin-${config.runId}-${room}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`admin_connect_timeout_${config.connectionTimeoutMs}ms`)),
      config.connectionTimeoutMs
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  await sleep(config.joinEmitDelayMs);
  socket.emit("room.join", { id: room });
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 750);
    socket.once("room.joined", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  socket.emit("player.info.joining", {
    id: adminId,
    name: "Load Test Presenter",
    room,
  });
  return { id: adminId, socket };
}

async function startRoom({ admin, room, config }) {
  const payload = {
    room,
    cmdId: `load-start-${config.runId}-${room}`,
  };
  if (config.adminToken) payload.token = config.adminToken;
  const response = await emitWithAck(
    admin.socket,
    "admin.presenter.start",
    payload,
    config.adminAckTimeoutMs
  );
  if (response && response.ok === false) {
    throw new Error(`admin_presenter_start_failed:${response.error || "unknown"}`);
  }
  return response;
}

async function endRoom({ admin, room, config }) {
  if (!admin?.socket?.connected) return null;
  const payload = {
    room,
    cmdId: `load-end-${config.runId}-${room}`,
  };
  if (config.adminToken) payload.token = config.adminToken;
  try {
    return await emitWithAck(
      admin.socket,
      "admin.presenter.end",
      payload,
      config.adminAckTimeoutMs
    );
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function buildTelemetryEvents(player) {
  const variant = player.index % 5;
  const score = player.tier * 1000 + player.index;
  const position = {
    x: Number(((player.index % 97) - 48 + player.tier / 100).toFixed(2)),
    y: 0,
    z: Number((((player.index * 7) % 89) - 44 - player.tier / 200).toFixed(2)),
  };
  const base = {
    sessionId: player.sessionId,
    roomId: player.room,
    playerId: player.id,
    playerName: player.name,
  };
  const events = [
    { ...base, type: "game_started", score: 0, metadata: { load_tier: player.tier } },
    { ...base, type: "position_sample", score, position },
  ];

  if (variant === 0) {
    events.push({
      ...base,
      type: "powerup_collected",
      score,
      position,
      itemId: `load-power-${player.index}`,
      powerupType: "powerup_magnet",
    });
  } else if (variant === 1) {
    events.push({
      ...base,
      type: "trail_crossed",
      score,
      position,
      relatedPlayerId: `load-rival-${player.index}`,
      metadata: { trail_segment_id: `load-seg-${player.index}` },
    });
    events.push({
      ...base,
      type: "player_frozen",
      score,
      position,
      relatedPlayerId: `load-rival-${player.index}`,
      freezeMs: 1000 + (player.index % 5) * 250,
    });
  } else if (variant === 2) {
    events.push({
      ...base,
      type: "marine_hit",
      score,
      position,
      itemId: `load-turtle-${player.index}`,
      metadata: { item_type: "turtle" },
    });
  } else {
    events.push({
      ...base,
      type: "trash_collected",
      score,
      position,
      itemId: `load-trash-${player.index}`,
      metadata: { item_type: "trash" },
    });
  }

  events.push({
    ...base,
    type: "game_over",
    score,
    position,
    metadata: {
      load_tier: player.tier,
      load_index: player.index,
      uniqueness_hint: `${player.name} finished at ${score} points`,
    },
  });
  return events;
}

function extractCommentary(body = {}) {
  const source = body.source || body.commentary?.source || "";
  const text =
    body.commentary?.commentary ||
    body.commentary?.text ||
    body.commentary?.script ||
    body.commentary ||
    body.text ||
    body.script ||
    "";
  const summary = body.summary || body.commentary?.summary || null;
  return { text: String(text || "").trim(), source, summary };
}

async function fetchJson(url, { method = "GET", body, timeoutMs = DEFAULT_SCORE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_) {
        json = { raw: text.slice(0, 1000) };
      }
    }
    if (!response.ok) {
      throw new Error(`http_${response.status}:${text.slice(0, 300)}`);
    }
    return json || {};
  } finally {
    clearTimeout(timer);
  }
}

async function writeAndVerifyScoreRow(player, config) {
  if (config.requireScoreRows === false) {
    player.scoreRow = { attempted: false, ok: true, skipped: true };
    return player.scoreRow;
  }

  const startedAt = Date.now();
  const encodedId = encodeURIComponent(player.id);
  const currentUrl = `${config.scoreBaseUrl}/api/score/${encodedId}`;
  const topUrl = `${config.scoreBaseUrl}/api/top/score/${encodedId}`;
  player.scoreRow = {
    attempted: true,
    ok: false,
    increments: config.scoreIncrements,
    currentUrl,
    topUrl,
  };

  try {
    let current = null;
    for (let i = 0; i < config.scoreIncrements; i++) {
      current = await fetchJson(currentUrl, {
        method: "PUT",
        body: { operationType: "INCREMENT", name: player.name },
        timeoutMs: config.scoreTimeoutMs,
      });
    }
    const top = await fetchJson(topUrl, {
      method: "GET",
      timeoutMs: config.scoreTimeoutMs,
    });
    const ok = top?.uuid === player.id && Number(top?.score) >= 1;
    player.scoreRow = {
      ...player.scoreRow,
      ok,
      current,
      top,
      score: Number(top?.score ?? current?.score ?? 0),
      latencyMs: Date.now() - startedAt,
      verifiedAt: nowIso(),
      error: ok ? undefined : `top_score_row_mismatch:${top?.uuid || "missing"}`,
    };
  } catch (error) {
    player.scoreRow = {
      ...player.scoreRow,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error && error.message ? error.message : String(error),
    };
    player.errors.push(`score_row_failed:${player.scoreRow.error}`);
  }
  return player.scoreRow;
}

async function runPlayerTelemetry(player, config) {
  if (!player.joined || !player.socket?.connected) return player;
  await writeAndVerifyScoreRow(player, config);

  const events = buildTelemetryEvents(player);
  const gameOverEvent = events[events.length - 1];

  for (const event of events.slice(0, -1)) {
    try {
      const response = await emitWithAck(player.socket, "game.event", event, config.eventAckTimeoutMs);
      if (response && response.ok === false) {
        player.errors.push(`game_event_failed:${event.type}:${response.error || "unknown"}`);
      }
    } catch (error) {
      player.errors.push(`game_event_ack_error:${event.type}:${error.message}`);
    }
  }

  const startedAt = Date.now();
  player.commentaryStartedAt = nowIso();

  let settleCommentary;
  let commentarySettled = false;
  const commentaryPromise = new Promise((resolve) => {
    settleCommentary = (body, via) => {
      if (commentarySettled) return;
      commentarySettled = true;
      const commentary = extractCommentary(body);
      player.commentary = {
        ...commentary,
        via,
        latencyMs: Date.now() - startedAt,
        receivedAt: nowIso(),
      };
      resolve(player.commentary);
    };
  });

  const commentaryTimer = setTimeout(() => {
    settleCommentary(
      { commentary: "", source: "" },
      `timeout_${config.commentaryTimeoutMs}ms`
    );
  }, config.commentaryTimeoutMs);

  const handler = (body = {}) => {
    if (body.player_id && body.player_id !== player.id) return;
    settleCommentary(body, "event");
  };
  player.socket.on("commentary.ready", handler);

  try {
    const response = await emitWithAck(
      player.socket,
      "game.event",
      gameOverEvent,
      config.commentaryTimeoutMs
    );
    if (response && response.ok === false) {
      player.errors.push(`game_over_failed:${response.error || "unknown"}`);
    }
    if (response?.commentary) settleCommentary(response.commentary, "ack");
  } catch (error) {
    player.errors.push(`game_over_ack_error:${error.message}`);
  }

  await commentaryPromise;
  clearTimeout(commentaryTimer);
  player.socket.off("commentary.ready", handler);
  return player;
}

async function runLimited(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export function evaluateTierGates(tierReport, config = {}) {
  const attempted = tierReport.attempted || 0;
  const joinedPlayers = (tierReport.players || []).filter((player) => player.joined);
  const joinFailures = attempted - joinedPlayers.length;
  const commentaryRequired = tierReport.commentaryAttempted !== false;
  const scoreRequired = config.requireScoreRows !== false && tierReport.scoreAttempted !== false;
  const commentaryPlayers = joinedPlayers.filter((player) => player.commentary?.text);
  const missingCommentary = joinedPlayers.filter((player) => !player.commentary?.text);
  const scorePlayers = joinedPlayers.filter((player) => player.scoreRow?.ok);
  const missingScoreRows = joinedPlayers.filter((player) => !player.scoreRow?.ok);
  const duplicates = findDuplicateCommentary(commentaryPlayers);
  const latencies = commentaryPlayers.map((player) => player.commentary.latencyMs);
  const p95 = percentile(latencies, 95);
  const disallowedSources = new Set(
    (config.disallowedSources || DEFAULT_DISALLOWED_SOURCES).map((item) => String(item).trim())
  );
  const sourceFailures = joinedPlayers.filter((player) => {
    const source = String(player.commentary?.source || "").trim();
    if (config.requireFullPath === false) return disallowedSources.has(source);
    return !source || disallowedSources.has(source);
  });

  const reasons = [];
  const joinReason = joinFailureReason(tierReport, config);
  if (joinReason) reasons.push(joinReason);
  if (commentaryRequired && missingCommentary.length) {
    reasons.push(`missing_commentary:${missingCommentary.length}`);
  }
  if (scoreRequired && missingScoreRows.length) {
    reasons.push(`missing_high_score_rows:${missingScoreRows.length}`);
  }
  if (duplicates.length) {
    reasons.push(`duplicate_commentary:${duplicates.length}`);
  }
  if (p95 != null && p95 > (config.commentaryTimeoutMs || DEFAULT_COMMENTARY_TIMEOUT_MS)) {
    reasons.push(`commentary_p95_above_threshold:${p95}ms`);
  }
  if (commentaryRequired && sourceFailures.length) {
    reasons.push(`commentary_source_not_full_path:${sourceFailures.length}`);
  }

  return {
    verdict: reasons.length ? "failed" : "passed",
    reasons,
    joined: joinedPlayers.length,
    joinFailures,
    scoreRows: {
      required: scoreRequired,
      verified: scorePlayers.length,
      missing: missingScoreRows.map((player) => player.id),
      failures: missingScoreRows.map((player) => ({
        id: player.id,
        error: player.scoreRow?.error || "missing",
      })),
    },
    commentaryReceived: commentaryPlayers.length,
    missingCommentary: missingCommentary.map((player) => player.id),
    duplicateTexts: duplicates,
    sourceFailures: sourceFailures.map((player) => ({
      id: player.id,
      source: player.commentary?.source || "",
    })),
    latency: {
      p50: percentile(latencies, 50),
      p95,
      max: percentile(latencies, 100),
    },
    sourceCounts: sourceCounts(commentaryPlayers),
  };
}

function sourceCounts(players = []) {
  const counts = {};
  for (const player of players) {
    const source = player.commentary?.source || "missing";
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

function closeSocket(socket) {
  try {
    socket.removeAllListeners();
    socket.close();
  } catch (_) {
    // best-effort cleanup
  }
}

async function captureCommand(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          command: [cmd, ...args].join(" "),
          error: error.message,
          stderr: String(stderr || "").slice(0, 4000),
        });
        return;
      }
      const text = String(stdout || "");
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        // leave as text
      }
      resolve({
        ok: true,
        command: [cmd, ...args].join(" "),
        json,
        stdout: json ? undefined : text.slice(0, 8000),
      });
    });
  });
}

async function captureK8sSnapshot(config) {
  if (!config.captureK8s) return { skipped: true };
  const ns = config.namespace || DEFAULT_NAMESPACE;
  const [hpa, pods] = await Promise.all([
    captureCommand("kubectl", ["-n", ns, "get", "hpa", "-o", "json"]),
    captureCommand("kubectl", ["-n", ns, "get", "pods", "-o", "json"]),
  ]);
  return { namespace: ns, hpa, pods };
}

async function writeReports(runReport, config) {
  const runDir = path.join(config.outputDir, config.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "run.json"), stringifyRunReport(runReport), "utf8");
  await writeFile(path.join(runDir, "summary.md"), renderMarkdownSummary(runReport), "utf8");
}

function reportJsonReplacer(key, value) {
  if (key === "socket") return undefined;
  return value;
}

export function stringifyRunReport(runReport) {
  return JSON.stringify(runReport, reportJsonReplacer, 2);
}

function renderMarkdownSummary(runReport) {
  const lines = [
    `# Save The Wildlife Production Load Run ${runReport.runId}`,
    "",
    `- Started: ${runReport.startedAt}`,
    `- Finished: ${runReport.finishedAt || "in progress"}`,
    `- Target: ${runReport.target.socketUrl}${runReport.target.socketPath}`,
    `- Score API: ${runReport.target.scoreBaseUrl}/api/score`,
    `- Verdict: ${runReport.verdict || "running"}`,
    "",
    "| Tier | Room | Verdict | Joined | Join failures | High-score rows | Commentary | p95 commentary | Duplicates | Sources |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const tier of runReport.tiers) {
    const gates = tier.gates || {};
    const sources = Object.entries(gates.sourceCounts || {})
      .map(([source, count]) => `${source}:${count}`)
      .join(", ");
    lines.push(
      `| ${tier.tier} | ${tier.room} | ${gates.verdict || "running"} | ${gates.joined ?? 0}/${tier.attempted} | ${gates.joinFailures ?? 0} | ${gates.scoreRows?.verified ?? 0} | ${gates.commentaryReceived ?? 0} | ${gates.latency?.p95 ?? ""} | ${gates.duplicateTexts?.length ?? 0} | ${sources || ""} |`
    );
  }

  for (const tier of runReport.tiers) {
    if (!tier.gates?.reasons?.length) continue;
    lines.push("", `## Tier ${tier.tier} Failures`);
    for (const reason of tier.gates.reasons) lines.push(`- ${reason}`);
  }

  for (const tier of runReport.tiers) {
    const samples = (tier.players || [])
      .filter((player) => player.commentary?.text)
      .slice(0, COMMENTARY_SAMPLE_LIMIT);
    if (!samples.length) continue;
    lines.push("", `## Tier ${tier.tier} Commentary Samples`);
    for (const player of samples) {
      lines.push(`- ${player.name}: ${player.commentary.text}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function runTier(tier, config) {
  const tierPlan = planTier(tier, config);
  const tierReport = {
    tier,
    room: tierPlan.room,
    attempted: tier,
    startedAt: nowIso(),
    plan: tierPlan,
    players: [],
    k8sBefore: await captureK8sSnapshot(config),
  };
  let admin = null;

  try {
    admin = await connectAdmin({ room: tierPlan.room, config });
    const playerPromises = [];
    for (let index = 1; index <= tier; index++) {
      playerPromises.push(connectPlayer({ index, tier, room: tierPlan.room, config }));
      await sleep(tierPlan.joinDelayMs);
    }
    tierReport.players = await Promise.all(playerPromises);
    tierReport.joinedAt = nowIso();

    const joinReason = joinFailureReason(tierReport, config);
    if (joinReason) {
      tierReport.commentaryAttempted = false;
      tierReport.scoreAttempted = false;
      tierReport.aborted = true;
      tierReport.abortReason = joinReason;
      tierReport.finishedAt = nowIso();
      tierReport.k8sAfter = await captureK8sSnapshot(config);
      tierReport.gates = evaluateTierGates(tierReport, config);
      return tierReport;
    }

    await startRoom({ admin, room: tierPlan.room, config });
    tierReport.startedRoomAt = nowIso();

    const joinedPlayers = tierReport.players.filter((player) => player.joined);
    tierReport.scoreAttempted = true;
    tierReport.commentaryAttempted = true;
    await runLimited(joinedPlayers, tierPlan.commentaryConcurrency, (player) =>
      runPlayerTelemetry(player, config)
    );

    tierReport.finishedAt = nowIso();
    tierReport.k8sAfter = await captureK8sSnapshot(config);
    tierReport.gates = evaluateTierGates(tierReport, config);
  } catch (error) {
    tierReport.finishedAt = nowIso();
    tierReport.error = error.message;
    tierReport.gates = {
      verdict: "failed",
      reasons: [`tier_runner_error:${error.message}`],
      joined: tierReport.players.filter((player) => player.joined).length,
      joinFailures: tier - tierReport.players.filter((player) => player.joined).length,
      commentaryReceived: tierReport.players.filter((player) => player.commentary?.text).length,
      latency: { p50: null, p95: null, max: null },
      sourceCounts: sourceCounts(tierReport.players),
    };
  } finally {
    await endRoom({ admin, room: tierPlan.room, config });
    if (admin) closeSocket(admin.socket);
    for (const player of tierReport.players) closeSocket(player.socket);
  }

  return tierReport;
}

export async function runLoad(config = loadConfig()) {
  const runReport = {
    runId: config.runId,
    startedAt: nowIso(),
    target: {
      socketUrl: config.socketUrl,
      socketPath: config.socketPath,
      scoreBaseUrl: config.scoreBaseUrl,
      namespace: config.namespace,
    },
    tiers: [],
    verdict: "running",
  };

  await writeReports(runReport, config);

  for (const tier of config.tiers) {
    console.log(`[load] tier ${tier} starting`);
    const tierReport = await runTier(tier, config);
    runReport.tiers.push(tierReport);
    runReport.verdict = tierReport.gates.verdict === "failed" ? "failed" : "running";
    await writeReports(runReport, config);
    console.log(`[load] tier ${tier} ${tierReport.gates.verdict}`);
    if (tierReport.gates.verdict === "failed") break;
  }

  if (runReport.verdict !== "failed") runReport.verdict = "passed";
  runReport.finishedAt = nowIso();
  await writeReports(runReport, config);
  return runReport;
}

async function main() {
  const config = loadConfig();
  const report = await runLoad(config);
  const summaryPath = path.join(config.outputDir, config.runId, "summary.md");
  console.log(`[load] ${report.verdict}. Report: ${summaryPath}`);
  if (report.verdict !== "passed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[load] failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
