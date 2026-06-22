import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8080);
const pafMetrics = {
  startedAt: Date.now(),
  commentaryRequests: 0,
  commentaryFailures: 0,
  contextRequests: 0,
  contextFailures: 0,
};
const AGENT_NAME = process.env.PAF_AGENT_NAME || "save-the-wildlife-commentator";
const AGENT_MODE = process.env.PAF_AGENT_MODE || "moderated";
const COMMENTARY_MAX_CHARS = Number(process.env.PAF_COMMENTARY_MAX_CHARS || 200);
const ORACLE_QUERY_TIMEOUT_MS = Number(process.env.PAF_ORACLE_QUERY_TIMEOUT_MS || 2000);
const INDB_AGENT_TIMEOUT_MS = Number(process.env.INDB_AGENT_TIMEOUT_MS || 2500);
const INDB_AGENT_PACKAGE = safeIdentifier(process.env.INDB_AGENT_PACKAGE || "STWL_COMMENTARY_PKG");
const GAME_EVENTS_TABLE = safeIdentifier(process.env.GAME_EVENTS_TABLE || "STWL_GAME_EVENTS");
const REPLAY_CLIPS_TABLE = safeIdentifier(process.env.REPLAY_CLIPS_TABLE || "STWL_REPLAY_CLIPS");
const AGENT_MEMORIES_TABLE = safeIdentifier(process.env.AGENT_MEMORIES_TABLE || "STWL_AGENT_MEMORIES");
const ORACLE_CONFIG_DIR = process.env.ORACLE_CONFIG_DIR || process.env.TNS_ADMIN || (existsSync("/wallet") ? "/wallet" : "");
const profanityPattern = /\b(fuck|shit|bitch|asshole|bastard|dick|cunt)\b/i;
const commentaryMetaPattern = /\b(oracle|database|sql|model|models|telemetry|evidence|prediction|predictions|agent|select ai|genai|llm)\b/i;
const BOT_POLICY_SCHEMA_VERSION = "stwl.bot-policy.v1";
const APPROVED_BOT_POLICY_CATALOG = [
  {
    id: "efficient-cleaner-v1",
    name: "PAF Efficient Cleaner",
    source: "paf",
    version: "1.0.0",
    targetPriority: ["trash", "powerup_magnet", "powerup_speed"],
    risk: "low",
    aggression: 0.18,
    throttle: 0.74,
    notes: "Clean nearby trash first, use magnet or speed only when it improves safe collection.",
  },
  {
    id: "shield-hunter-v1",
    name: "PAF Shield Hunter",
    source: "paf",
    version: "1.0.0",
    targetPriority: ["powerup_shield", "trash", "powerup_freeze"],
    risk: "medium",
    aggression: 0.35,
    throttle: 0.82,
    notes: "Prioritize shields, then clean nearby trash, avoid marine hits.",
  },
  {
    id: "freeze-ambusher-v1",
    name: "PAF Freeze Ambusher",
    source: "paf",
    version: "1.0.0",
    targetPriority: ["powerup_freeze", "trash", "powerup_shield"],
    risk: "medium",
    aggression: 0.58,
    throttle: 0.78,
    notes: "Seek freeze powerups and create trail-crossing moments without reckless marine contact.",
  },
  {
    id: "risk-taker-v1",
    name: "PAF Risk Taker",
    source: "paf",
    version: "1.0.0",
    targetPriority: ["powerup_speed", "trash", "powerup_freeze", "marine"],
    risk: "high",
    aggression: 0.74,
    throttle: 0.9,
    notes: "Chase high tempo pickups for richer evaluation data while keeping movement bounded.",
  },
];
const DEFAULT_CANVAS_TIMEOUT_MS = 8000;
const DEFAULT_COMMENTARY_DEADLINE_MS = 9000;
const DEFAULT_CANVAS_RETURN_RESERVE_MS = 1000;
const DEFAULT_CANVAS_MIN_TIMEOUT_MS = 250;
const DEFAULT_MODEL_ROUTE_RETURN_RESERVE_MS = 350;
let inDbPackageInitAttempted = false;
let selectAiInitAttempted = false;
let matchIntelligenceInitAttempted = false;
let learningSchemaInitAttempted = false;

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

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function slugValue(value, fallback) {
  const slug = textValue(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function stageSafePolicyText(value, fallback, maxLength) {
  const text = textValue(value, fallback).replace(/\s+/g, " ");
  if (profanityPattern.test(text)) return fallback.slice(0, maxLength);
  return text.slice(0, maxLength);
}

function normalizePolicyPriority(value, fallback = ["trash", "powerup_shield", "powerup_freeze"]) {
  const valid = new Set([
    "trash",
    "marine",
    "powerup",
    "powerup_speed",
    "powerup_shield",
    "powerup_magnet",
    "powerup_freeze",
  ]);
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = raw
    .map((entry) => String(entry || "").trim().toLowerCase())
    .map((entry) => entry.startsWith("shield") ? "powerup_shield" : entry)
    .filter((entry) => valid.has(entry));
  return normalized.length ? [...new Set(normalized)].slice(0, 6) : fallback.slice();
}

function normalizeApprovedBotPolicy(value = {}, fallback = APPROVED_BOT_POLICY_CATALOG[0]) {
  const sourcePolicy = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : APPROVED_BOT_POLICY_CATALOG[0];
  const risk = String(sourcePolicy.risk || base.risk || "medium").toLowerCase();
  return {
    id: slugValue(sourcePolicy.id || base.id, "bot-policy-v1"),
    name: stageSafePolicyText(sourcePolicy.name || base.name, "PAF Bot Policy", 48),
    source: stageSafePolicyText(sourcePolicy.source || base.source, "paf", 24),
    version: stageSafePolicyText(sourcePolicy.version || base.version, "1.0.0", 24),
    targetPriority: normalizePolicyPriority(sourcePolicy.targetPriority || sourcePolicy.target_priority, base.targetPriority),
    risk: ["low", "medium", "high"].includes(risk) ? risk : "medium",
    aggression: clampNumber(sourcePolicy.aggression, Number(base.aggression) || 0.35, 0, 1),
    throttle: clampNumber(sourcePolicy.throttle, Number(base.throttle) || 0.82, 0.15, 1),
    notes: stageSafePolicyText(sourcePolicy.notes || base.notes, "Approved deterministic bot policy.", 180),
  };
}

function configuredBotPolicies() {
  const raw = textValue(process.env.PAF_BOT_POLICIES_JSON || process.env.BOT_POLICIES_JSON);
  if (!raw) return APPROVED_BOT_POLICY_CATALOG;
  try {
    const parsed = JSON.parse(raw);
    const policies = Array.isArray(parsed) ? parsed : parsed?.policies;
    return Array.isArray(policies) && policies.length ? policies : APPROVED_BOT_POLICY_CATALOG;
  } catch (_) {
    return APPROVED_BOT_POLICY_CATALOG;
  }
}

function buildBotPolicyCatalog(options = {}) {
  const policies = configuredBotPolicies()
    .map((policy, index) => normalizeApprovedBotPolicy(policy, APPROVED_BOT_POLICY_CATALOG[index % APPROVED_BOT_POLICY_CATALOG.length]))
    .slice(0, 12);
  return {
    ok: true,
    schema_version: BOT_POLICY_SCHEMA_VERSION,
    source: textValue(options.source || "paf-approved-catalog"),
    teacher: "Oracle Private Agent Factory",
    deterministic_execution: true,
    runtime_contract: "PAF approves bounded policy cards; bot code executes movement deterministically without per-frame LLM calls.",
    policies,
  };
}

function boolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
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

function matchIntelligenceConfig() {
  return {
    enabled: boolEnv("PAF_MATCH_INTELLIGENCE_ENABLED", true),
    autoInit: boolEnv("PAF_MATCH_INTELLIGENCE_AUTO_INIT", true),
    graphEnabled: boolEnv("PAF_GRAPH_RETRIEVAL_ENABLED", true),
    replayEnabled: boolEnv("PAF_REPLAY_RETRIEVAL_ENABLED", true),
    vectorEnabled: boolEnv("PAF_VECTOR_RETRIEVAL_ENABLED", true),
    persistMemory: boolEnv("PAF_AGENT_MEMORY_PERSIST", true),
    maxEvents: Math.max(3, Math.min(50, Number(process.env.PAF_CONTEXT_MAX_EVENTS || 12))),
    maxReplayClips: Math.max(0, Math.min(10, Number(process.env.PAF_REPLAY_MAX_CLIPS || 3))),
    vectorTopK: Math.max(0, Math.min(10, Number(process.env.PAF_VECTOR_TOP_K || 3))),
    timeoutMs: Math.max(250, Math.min(8000, Number(process.env.PAF_CONTEXT_TIMEOUT_MS || 2500))),
    replayClipsTable: REPLAY_CLIPS_TABLE,
    agentMemoriesTable: AGENT_MEMORIES_TABLE,
  };
}

function modelRouterConfig() {
  const routeMode = textValue(process.env.PAF_MODEL_ROUTE_MODE || "shadow").toLowerCase();
  const verifyTlsValue = textValue(process.env.OCI_MODEL_ENDPOINT_VERIFY_TLS || "true").toLowerCase();
  return {
    routeMode: ["off", "primary", "shadow"].includes(routeMode) ? routeMode : "shadow",
    primaryProvider: textValue(process.env.PAF_PRIMARY_MODEL_PROVIDER || "oci-base"),
    candidateProvider: textValue(process.env.PAF_CANDIDATE_MODEL_PROVIDER || "oci-fine-tuned"),
    timeoutMs: Math.max(500, Math.min(60_000, numberValue(process.env.OCI_MODEL_ENDPOINT_TIMEOUT_MS || 15000, 15000))),
    authSecret: textValue(process.env.OCI_MODEL_ENDPOINT_AUTH_SECRET),
    verifyTls: !["0", "false", "no", "off"].includes(verifyTlsValue),
    tracePersist: boolEnv("PAF_TRACE_PERSIST", true),
    evalEnabled: boolEnv("PAF_EVAL_ENABLED", true),
    fastPathEnabled: boolEnv("PAF_MODEL_FAST_PATH_ENABLED", true),
    rubricVersion: textValue(process.env.PAF_EVAL_RUBRIC_VERSION || "stwl-commentary-v1"),
    trainingCaptureEnabled: boolEnv("PAF_TRAINING_CAPTURE_ENABLED", true),
    baseEndpointUrl: textValue(process.env.OCI_BASE_MODEL_ENDPOINT_URL),
    fineTunedEndpointUrl: textValue(process.env.OCI_FT_MODEL_ENDPOINT_URL),
    temperature: Math.max(0, Math.min(2, numberValue(process.env.OCI_MODEL_ENDPOINT_TEMPERATURE || 0.2, 0.2))),
    maxTokens: Math.max(32, Math.min(512, numberValue(process.env.OCI_MODEL_ENDPOINT_MAX_TOKENS || 120, 120))),
  };
}

function boundedMs(value, fallback, min = 1, max = 60_000) {
  return Math.max(min, Math.min(max, numberValue(value, fallback)));
}

function commentaryBudgetConfig() {
  return {
    deadlineMs: boundedMs(
      process.env.PAF_COMMENTARY_DEADLINE_MS || process.env.PAF_TOTAL_TIMEOUT_MS || DEFAULT_COMMENTARY_DEADLINE_MS,
      DEFAULT_COMMENTARY_DEADLINE_MS,
      50,
      60_000
    ),
    canvasReturnReserveMs: boundedMs(
      process.env.PAF_CANVAS_RETURN_RESERVE_MS || DEFAULT_CANVAS_RETURN_RESERVE_MS,
      DEFAULT_CANVAS_RETURN_RESERVE_MS,
      0,
      10_000
    ),
    canvasMinTimeoutMs: boundedMs(
      process.env.PAF_CANVAS_MIN_TIMEOUT_MS || DEFAULT_CANVAS_MIN_TIMEOUT_MS,
      DEFAULT_CANVAS_MIN_TIMEOUT_MS,
      1,
      10_000
    ),
  };
}

function providerEndpoint(provider, config = modelRouterConfig()) {
  if (provider === "oci-base") return config.baseEndpointUrl;
  if (provider === "oci-fine-tuned") return config.fineTunedEndpointUrl;
  return "";
}

function modelFastPathReady(config = modelRouterConfig()) {
  if (!config.fastPathEnabled || config.routeMode === "off") return false;
  return Boolean(providerEndpoint(config.primaryProvider, config));
}

function normalizeEndpointUrl(endpoint = "") {
  return textValue(endpoint).replace(/\/+$/, "");
}

function summarizeAdapterHealth(adapters = []) {
  const providerCounts = {};
  const runtimeCounts = {};
  const upstreamFormatCounts = {};
  for (const adapter of adapters) {
    const provider = adapter.provider || "unknown";
    const runtime = adapter.runtime_mode || "missing";
    const format = adapter.upstream_format || "missing";
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    runtimeCounts[`${provider}:${runtime}`] = (runtimeCounts[`${provider}:${runtime}`] || 0) + 1;
    upstreamFormatCounts[format] = (upstreamFormatCounts[format] || 0) + 1;
  }
  return {
    provider_counts: providerCounts,
    runtime_counts: runtimeCounts,
    upstream_format_counts: upstreamFormatCounts,
    upstream_llm_ready: adapters.length > 0 && adapters.every((adapter) =>
      adapter.ok === true && adapter.runtime_mode === "upstream-llm"
    ),
  };
}

async function probeModelAdapterHealth(provider, endpoint, options = {}) {
  const baseUrl = normalizeEndpointUrl(endpoint);
  if (!baseUrl) {
    return {
      ok: false,
      provider,
      configured: false,
      runtime_mode: null,
      upstream_format: null,
      model_id: null,
      error: "endpoint_not_configured",
    };
  }
  const timeoutMs = boundedMs(
    process.env.PAF_ADAPTER_HEALTH_TIMEOUT_MS || options.healthTimeoutMs || 900,
    900,
    100,
    5000
  );
  const headers = {
    Accept: "application/json",
    "User-Agent": "save-the-wildlife-paf-health/1.0",
  };
  const authSecret = textValue(options.authSecret || process.env.OCI_MODEL_ENDPOINT_AUTH_SECRET);
  if (authSecret) headers.Authorization = `Bearer ${authSecret}`;
  try {
    const response = await requestJson(`${baseUrl}/healthz`, {
      method: "GET",
      timeoutMs,
      verifyTls: options.verifyTls,
      headers,
    });
    const payload = response.payload || {};
    return {
      ok: response.status >= 200 && response.status < 300 && payload.ok === true,
      provider: payload.provider || provider,
      configured: true,
      runtime_mode: payload.runtime_mode || null,
      upstream_format: payload.upstream_format || null,
      model_id: payload.model_id || null,
      facts_policy: payload.facts_policy || null,
      strict_upstream_warnings: payload.strict_upstream_warnings ?? null,
      status: response.status,
      elapsed_ms: response.elapsed_ms,
    };
  } catch (error) {
    return {
      ok: false,
      provider,
      configured: true,
      runtime_mode: null,
      upstream_format: null,
      model_id: null,
      error: error.message,
    };
  }
}

async function modelAdapterHealth(config = modelRouterConfig()) {
  const adapters = await Promise.all([
    probeModelAdapterHealth(config.primaryProvider, providerEndpoint(config.primaryProvider, config), config),
    probeModelAdapterHealth(config.candidateProvider, providerEndpoint(config.candidateProvider, config), config),
  ]);
  return {
    adapters,
    summary: summarizeAdapterHealth(adapters),
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
    room_id: textValue(summary.room_id || summary.roomId),
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
  text = text.replace(/^["“”]+|["“”]+$/g, "").trim();
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

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function compactEvent(row = {}) {
  const metadata = parseMetadata(row.METADATA_JSON || row.metadata_json || row.metadata);
  const position = row.X == null && row.Z == null && row.x == null && row.z == null
    ? null
    : {
        x: numberValue(row.X ?? row.x, 0),
        y: numberValue(row.Y ?? row.y, 0),
        z: numberValue(row.Z ?? row.z, 0),
      };
  return {
    id: row.ID ?? row.id ?? null,
    type: textValue(row.EVENT_TYPE || row.event_type),
    at: textValue(row.OCCURRED_AT || row.occurred_at),
    score: numberValue(row.SCORE ?? row.score, 0),
    position,
    related_player_id: textValue(row.RELATED_PLAYER_ID || row.related_player_id) || null,
    related_item_id: textValue(row.RELATED_ITEM_ID || row.related_item_id) || null,
    metadata,
  };
}

function compactGraphFacts(events = [], summary = {}) {
  const facts = [];
  const player = summary.player_name || summary.player_id || "Player";
  for (const event of events) {
    if (event.type === "powerup_collected") {
      const powerup = textValue(event.metadata.powerup_type || event.metadata.powerupType, "powerup");
      facts.push({
        type: "player_collected_powerup",
        subject: player,
        object: powerup,
        item_id: event.related_item_id,
        at: event.at,
      });
    } else if (event.type === "trail_crossed") {
      facts.push({
        type: "player_crossed_trail",
        subject: player,
        object: event.related_player_id || "another_player",
        at: event.at,
        position: event.position,
      });
    } else if (event.type === "player_frozen") {
      facts.push({
        type: "player_frozen_by_trail",
        subject: player,
        object: event.related_player_id || "another_player",
        duration_ms: numberValue(event.metadata.freeze_ms || event.metadata.freezeMs, null),
        at: event.at,
      });
    } else if (event.type === "marine_hit") {
      facts.push({
        type: "player_hit_marine_life",
        subject: player,
        object: event.related_item_id || textValue(event.metadata.item_type || event.metadata.itemType, "marine_life"),
        at: event.at,
      });
    } else if (event.type === "trash_collected") {
      facts.push({
        type: "player_collected_trash",
        subject: player,
        object: event.related_item_id || "trash",
        at: event.at,
      });
    }
  }
  return facts.slice(0, 12);
}

function normalizeReplayClip(row = {}) {
  const tags = parseMetadata(row.TAGS_JSON || row.tags_json || row.tags);
  const metadata = parseMetadata(row.METADATA_JSON || row.metadata_json || row.metadata);
  const replay = parseMetadata(row.REPLAY_JSON || row.replay_json || row.replay);
  return {
    clip_id: textValue(row.CLIP_ID || row.clip_id),
    session_id: textValue(row.SESSION_ID || row.session_id),
    room_id: textValue(row.ROOM_ID || row.room_id),
    player_id: textValue(row.PLAYER_ID || row.player_id),
    event_type: textValue(row.EVENT_TYPE || row.event_type),
    event_at: textValue(row.EVENT_AT || row.event_at),
    clip_uri: textValue(row.CLIP_URI || row.clip_uri) || null,
    thumbnail_uri: textValue(row.THUMBNAIL_URI || row.thumbnail_uri) || null,
    timecode_start_ms: numberValue(row.TIMECODE_START_MS ?? row.timecode_start_ms, null),
    timecode_end_ms: numberValue(row.TIMECODE_END_MS ?? row.timecode_end_ms, null),
    frame_count: numberValue(row.FRAME_COUNT ?? row.frame_count, replay?.clip?.frames?.length || null),
    moderation_status: textValue(row.MODERATION_STATUS || row.moderation_status, "approved"),
    tags,
    metadata,
  };
}

function normalizeMemory(row = {}) {
  return {
    memory_id: textValue(row.MEMORY_ID || row.memory_id),
    session_id: textValue(row.SESSION_ID || row.session_id),
    player_id: textValue(row.PLAYER_ID || row.player_id),
    memory_type: textValue(row.MEMORY_TYPE || row.memory_type, "session"),
    content: enforceCommentary(row.CONTENT || row.content || row.EMBEDDING_TEXT || row.embedding_text || "", 200),
    score: numberValue(row.SCORE ?? row.score, null),
    metadata: parseMetadata(row.METADATA_JSON || row.metadata_json || row.metadata),
  };
}

function clipTimePhrase(clip) {
  if (!clip || clip.timecode_start_ms == null || clip.timecode_end_ms == null) return "";
  const start = (clip.timecode_start_ms / 1000).toFixed(1);
  const end = (clip.timecode_end_ms / 1000).toFixed(1);
  return ` ${start}s-${end}s`;
}

function formatList(items, mapper, empty = "none") {
  const values = (items || []).map(mapper).filter(Boolean);
  return values.length ? values.slice(0, 4).join(" | ") : empty;
}

function buildEvidenceFormats(summary, context = {}, maxChars = COMMENTARY_MAX_CHARS) {
  const powerups = compactPowerupNames(summary.powerups);
  const topReplay = (context.replay_clips || [])[0] || null;
  const topMemory = (context.vector_memories || [])[0] || null;
  const replayCaption = topReplay
    ? enforceCommentary(
        `${topReplay.event_type || "Replay"} clip${clipTimePhrase(topReplay)}: ${summary.player_name || "Player"} at ${summary.score} points, ${coordinatePhrase(summary.last_position)}.`,
        maxChars
      )
    : null;
  const clipTitle = topReplay
    ? enforceCommentary(
        `${String(topReplay.event_type || "highlight").replace(/_/g, " ")} - ${summary.player_name || "Player"} ${summary.score} pts`,
        80
      )
    : null;
  const liveLine = deterministicScript(summary, maxChars);
  const recapParts = [
    `${summary.player_name || "Player"} finished with ${summary.score} points`,
    powerups.length ? `used ${powerups.join(", ")}` : "",
    summary.trail_crosses ? `${summary.trail_crosses} trail crossing(s)` : "",
    summary.freezes ? `${summary.freezes} freeze event(s)` : "",
    topReplay ? "replay evidence captured" : "",
    topMemory ? "similar prior memory found" : "",
  ].filter(Boolean);
  return {
    live_line: liveLine,
    replay_caption: replayCaption,
    post_match_recap: enforceCommentary(`${recapParts.join(", ")}.`, Math.min(500, Math.max(200, maxChars))),
    clip_title: clipTitle,
  };
}

function outputFormat(value) {
  const format = textValue(value || "live_line").toLowerCase();
  return ["live_line", "replay_caption", "post_match_recap", "clip_title"].includes(format)
    ? format
    : "live_line";
}

function compactContextForPrompt(context = {}) {
  return {
    graph: formatList(context.graph_facts, (fact) => `${fact.type}:${fact.subject}->${fact.object}`),
    replay: formatList(context.replay_clips, (clip) => `${clip.event_type}${clipTimePhrase(clip)}:${clip.clip_uri || "json_clip"}`),
    memory: formatList(context.vector_memories, (memory) => memory.content),
  };
}

function buildCanvasMessage(summary, options = {}) {
  const powerups = Object.entries(summary.powerups || {})
    .map(([name, count]) => `${name}:${count}`)
    .join(",") || "none";
  const prior = summary.prior_best_score == null ? "none" : String(summary.prior_best_score);
  const inDbDraft = textValue(options.inDbCommentary);
  const requestedOutput = outputFormat(options.outputFormat);
  const context = compactContextForPrompt(options.context || {});
  return [
    "You are the Save the Wildlife conference commentator in Oracle Private Agent Factory Canvas.",
    "Use only this SQL gameplay telemetry and the optional Oracle AI Database draft. Do not invent events, animals, players, or history.",
    requestedOutput === "post_match_recap"
      ? "Return one profanity-free post-match recap grounded in evidence."
      : "Return one profanity-free commentator line under 200 characters.",
    "Mention powerups, trail crossing/freezing, coordinates, or prior best only when present.",
    "Mention replay clips only when replay_evidence is not none.",
    `requested_output=${requestedOutput}`,
    inDbDraft ? `oracle_ai_database_draft=${inDbDraft}` : "oracle_ai_database_draft=none",
    `telemetry: session=${summary.session_id || "unknown"}; player=${summary.player_name || summary.player_id || "Player"}; score=${summary.score}; trash=${summary.trash_collected}; marine_hits=${summary.marine_hits}; powerups=${powerups}; trail_crosses=${summary.trail_crosses}; freezes=${summary.freezes}; ${coordinatePhrase(summary.last_position)}; prior_best=${prior}.`,
    `graph_facts=${context.graph}`,
    `replay_evidence=${context.replay}`,
    `vector_memories=${context.memory}`,
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

function stableJson(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function compactHash(value) {
  return sha256(value).slice(0, 16);
}

function newTraceId(summary = {}) {
  const session = textValue(summary.session_id || "nosession").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "nosession";
  return `stwl-${session}-${randomUUID().slice(0, 8)}`;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").trim().split(/\s+/).filter(Boolean).length * 1.25));
}

function buildModelEvidence(summary, context = {}, legacy = {}) {
  return {
    summary,
    formats: legacy.formats || {},
    legacy_source: legacy.source || "",
    legacy_commentary: legacy.commentary || "",
    in_db_agent: legacy.inDbAgent || null,
    canvas: legacy.canvas || null,
    evidence: {
      json_events: (context.json_events || []).slice(0, 12),
      graph_facts: (context.graph_facts || []).slice(0, 8),
      replay_clips: (context.replay_clips || []).slice(0, 4),
      vector_memories: (context.vector_memories || []).slice(0, 4),
      capabilities: context.capabilities || null,
    },
  };
}

function buildModelPrompt(summary, context = {}, legacy = {}, outputFormatValue = "live_line", maxChars = COMMENTARY_MAX_CHARS) {
  const requestedOutput = outputFormat(outputFormatValue);
  const baseMessage = buildCanvasMessage(summary, {
    inDbCommentary: legacy.inDbAgent?.commentary || legacy.commentary,
    context,
    outputFormat: requestedOutput,
  });
  return [
    baseMessage,
    "",
    "Model comparison task:",
    "Return JSON-compatible concise commentary text only. Do not store or invent changing facts in weights; use the supplied evidence.",
    "Include evidence-aware phrasing, avoid unsupported claims, and keep confidence proportional to the evidence.",
    `max_chars=${requestedOutput === "clip_title" ? Math.min(80, maxChars) : maxChars}`,
  ].join("\n");
}

function normalizeModelEndpointResponse(provider, response, elapsedMs, maxChars) {
  const payload = response?.payload;
  const text = textFromContent(payload?.text)
    || textFromContent(payload?.commentary)
    || textFromContent(payload?.message)
    || textFromContent(payload?.output)
    || textFromContent(payload?.choices?.[0]?.message?.content)
    || textFromContent(payload?.choices?.[0]?.text)
    || "";
  if (!text) throw new Error(`${provider}_empty_response`);
  const usage = payload?.usage || {};
  return {
    ok: payload?.ok === false ? false : true,
    provider: textValue(payload?.provider, provider),
    model_id: textValue(payload?.model_id || payload?.model || payload?.id, provider),
    text: enforceCommentary(text, maxChars || COMMENTARY_MAX_CHARS),
    tokens: numberValue(payload?.tokens ?? usage.total_tokens ?? usage.completion_tokens, estimateTokens(text)),
    latency_ms: numberValue(payload?.latency_ms ?? elapsedMs, elapsedMs),
    finish_reason: textValue(payload?.finish_reason || payload?.choices?.[0]?.finish_reason, "stop"),
    warnings: Array.isArray(payload?.warnings) ? payload.warnings.map(String) : [],
    runtime_mode: textValue(payload?.runtime_mode || payload?.runtimeMode),
    upstream_configured: typeof payload?.upstream_configured === "boolean" ? payload.upstream_configured : null,
    facts_policy: textValue(payload?.facts_policy || payload?.factsPolicy),
    status: response.status,
  };
}

async function callExternalModelProvider(provider, requestPayload, config, options = {}) {
  const endpoint = providerEndpoint(provider, config);
  if (!endpoint) {
    return {
      ok: false,
      provider,
      skipped: true,
      error: `${provider}_endpoint_missing`,
    };
  }
  const requestFn = options.modelRequestJson || options.requestJson || requestJson;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "save-the-wildlife-model-router/1.0",
  };
  if (config.authSecret) headers.Authorization = `Bearer ${config.authSecret}`;
  const response = await requestFn(endpoint, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    verifyTls: config.verifyTls,
    headers,
    body: JSON.stringify(requestPayload),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${provider}_http_${response.status}`);
  }
  return normalizeModelEndpointResponse(provider, response, response.elapsed_ms, requestPayload.max_chars || COMMENTARY_MAX_CHARS);
}

async function callModelProvider(provider, requestPayload, config, options = {}, legacy = {}) {
  const started = Date.now();
  try {
    if (provider === "deterministic") {
      const text = deterministicScript(requestPayload.route_context?.summary || {}, requestPayload.max_chars || COMMENTARY_MAX_CHARS);
      return {
        ok: true,
        provider,
        model_id: "deterministic-script",
        text,
        tokens: estimateTokens(text),
        latency_ms: Date.now() - started,
        finish_reason: "local",
        warnings: [],
      };
    }
    if (provider === "select-ai-canvas") {
      if (!legacy.commentary) {
        return { ok: false, provider, skipped: true, error: "select_ai_canvas_output_missing" };
      }
      return {
        ok: true,
        provider,
        model_id: legacy.source || "select-ai-canvas",
        text: legacy.commentary,
        tokens: estimateTokens(legacy.commentary),
        latency_ms: numberValue(legacy.latency_ms, Date.now() - started),
        finish_reason: "legacy-path",
        warnings: [],
      };
    }
    if (provider === "oci-base" || provider === "oci-fine-tuned") {
      return await callExternalModelProvider(provider, requestPayload, config, options);
    }
    return { ok: false, provider, skipped: true, error: `${provider}_unsupported` };
  } catch (error) {
    return {
      ok: false,
      provider,
      error: error && error.message ? error.message : String(error),
      latency_ms: Date.now() - started,
    };
  }
}

function scoreTextAgainstEvidence(text, summary = {}, maxChars = COMMENTARY_MAX_CHARS) {
  const normalized = String(text || "").toLowerCase();
  const powerups = compactPowerupNames(summary.powerups);
  const mentionsScore = normalized.includes(String(summary.score));
  const mentionsPlayer = summary.player_name && normalized.includes(String(summary.player_name).toLowerCase());
  const mentionsPowerup = /powerup|shield|magnet|freeze|boost/.test(normalized);
  const mentionsFreeze = /frozen|freeze/.test(normalized);
  const mentionsTrail = /trail|cross/.test(normalized);
  const mentionsWin = /\b(win|wins|won|victory|champion)\b/.test(normalized);
  const unsupportedFreeze = mentionsFreeze && !summary.freezes && !powerups.includes("freeze");
  const unsupportedPowerup = mentionsPowerup && powerups.length === 0 && !summary.freezes;
  const unsupportedTrail = mentionsTrail && !summary.trail_crosses;
  const unsupportedOutcome = mentionsWin;
  const tokenCount = estimateTokens(text);
  return {
    uses_retrieved_evidence: Boolean(mentionsScore || mentionsPlayer || (summary.freezes && mentionsFreeze) || (summary.trail_crosses && mentionsTrail) || (powerups.length && mentionsPowerup)),
    no_hallucinated_game_facts: !(unsupportedFreeze || unsupportedPowerup || unsupportedTrail || unsupportedOutcome),
    unique_commentary: Boolean(normalized && normalized !== normalizeSummary({}).player_name.toLowerCase()),
    commentary_quality: Boolean(text && text.length >= 24 && text.length <= Math.max(40, Math.min(200, maxChars))),
    confidence_calibrated: !/\b(definitely|guaranteed|certainly|undeniably)\b/i.test(text || ""),
    token_efficiency: tokenCount <= 42,
    safe_for_stage: !profanityPattern.test(text || ""),
    token_count: tokenCount,
  };
}

function modelOutputGate(output, summary = {}, maxChars = COMMENTARY_MAX_CHARS) {
  if (!output?.ok || !output.text) {
    return { ok: false, reason: "missing_model_output", scores: null, meta_leak: false };
  }
  const scores = scoreTextAgainstEvidence(output.text, summary, maxChars);
  const metaLeak = commentaryMetaPattern.test(output.text || "");
  const ok = Boolean(
    scores.uses_retrieved_evidence &&
    scores.no_hallucinated_game_facts &&
    scores.commentary_quality &&
    scores.confidence_calibrated &&
    scores.safe_for_stage &&
    !metaLeak
  );
  let reason = "accepted";
  if (!ok) {
    if (metaLeak) reason = "meta_commentary";
    else if (!scores.uses_retrieved_evidence) reason = "not_evidence_anchored";
    else if (!scores.no_hallucinated_game_facts) reason = "unsupported_game_fact";
    else if (!scores.commentary_quality) reason = "quality_gate";
    else if (!scores.confidence_calibrated) reason = "overconfident";
    else if (!scores.safe_for_stage) reason = "safety_gate";
  }
  return { ok, reason, scores, meta_leak: metaLeak };
}

function evidenceFactGate(text, summary = {}, maxChars = COMMENTARY_MAX_CHARS) {
  const scores = scoreTextAgainstEvidence(text, summary, maxChars);
  const ok = Boolean(
    scores.no_hallucinated_game_facts &&
    scores.commentary_quality &&
    scores.confidence_calibrated &&
    scores.safe_for_stage
  );
  let reason = "accepted";
  if (!ok) {
    if (!scores.no_hallucinated_game_facts) reason = "unsupported_game_fact";
    else if (!scores.commentary_quality) reason = "quality_gate";
    else if (!scores.confidence_calibrated) reason = "overconfident";
    else if (!scores.safe_for_stage) reason = "safety_gate";
  }
  return { ok, reason, scores };
}

function booleanScore(scores = {}) {
  return Object.entries(scores)
    .filter(([key]) => !key.endsWith("_count") && key !== "token_count")
    .reduce((total, [, value]) => total + (value === true ? 1 : 0), 0);
}

function evaluateModelOutputs(primary, candidate, summary, config, maxChars) {
  if (!config.evalEnabled || !primary?.ok || !candidate?.ok) {
    return {
      rubric_version: config.rubricVersion,
      verdict: "not_evaluated",
      reason: !config.evalEnabled ? "eval_disabled" : "missing_primary_or_candidate",
      primary: primary?.ok ? scoreTextAgainstEvidence(primary.text, summary, maxChars) : null,
      candidate: candidate?.ok ? scoreTextAgainstEvidence(candidate.text, summary, maxChars) : null,
    };
  }
  const primaryScores = scoreTextAgainstEvidence(primary.text, summary, maxChars);
  const candidateScores = scoreTextAgainstEvidence(candidate.text, summary, maxChars);
  const primaryTotal = booleanScore(primaryScores);
  const candidateTotal = booleanScore(candidateScores);
  const grounded = candidateScores.uses_retrieved_evidence && candidateScores.no_hallucinated_game_facts;
  const calibrated = candidateScores.confidence_calibrated && candidateScores.safe_for_stage;
  const betterEfficiency = candidateScores.token_count <= primaryScores.token_count;
  const noRegression = candidateTotal >= primaryTotal && grounded && calibrated;
  return {
    rubric_version: config.rubricVersion,
    verdict: noRegression && betterEfficiency ? "candidate_ready" : "hold",
    reason: noRegression ? (betterEfficiency ? "candidate_met_promotion_gate" : "candidate_not_more_efficient") : "candidate_regressed_or_ungrounded",
    primary: primaryScores,
    candidate: candidateScores,
    primary_total: primaryTotal,
    candidate_total: candidateTotal,
  };
}

async function runModelRoute({ summary, context, legacy, outputFormatValue, maxChars }, options = {}) {
  const config = modelRouterConfig();
  const traceId = textValue(options.traceId || options.trace_id || options.traceID) || newTraceId(summary);
  const evidence = buildModelEvidence(summary, context || {}, legacy || {});
  const prompt = buildModelPrompt(summary, context || {}, legacy || {}, outputFormatValue, maxChars);
  const promptHash = compactHash(prompt);
  const evidenceHash = compactHash(stableJson(evidence));
  const routeContext = {
    summary,
    output_format: outputFormatValue,
    max_chars: maxChars,
    route_mode: config.routeMode,
    primary_provider: config.primaryProvider,
    candidate_provider: config.candidateProvider,
    legacy_source: legacy?.source || "",
  };
  const requestPayload = {
    trace_id: traceId,
    system: "Save the Wildlife PAF model router. Facts stay in Oracle AI Database memory; model weights shape stable response behavior.",
    prompt,
    evidence,
    max_tokens: config.maxTokens,
    max_chars: maxChars,
    temperature: config.temperature,
    route_context: routeContext,
  };

  let primary = null;
  let candidate = null;
  if (config.routeMode !== "off") {
    primary = await callModelProvider(config.primaryProvider, requestPayload, config, options, legacy);
    if (config.routeMode === "shadow" && config.candidateProvider && config.candidateProvider !== config.primaryProvider) {
      candidate = await callModelProvider(config.candidateProvider, requestPayload, config, options, legacy);
    }
  }

  const evalScores = evaluateModelOutputs(primary, candidate, summary, config, maxChars);
  const selected = primary?.ok ? primary : null;
  const route = {
    trace_id: traceId,
    route_mode: config.routeMode,
    primary_provider: config.primaryProvider,
    candidate_provider: config.candidateProvider || null,
    model_id: selected?.model_id || null,
    latency_ms: selected?.latency_ms ?? null,
    evidence_hash: evidenceHash,
    prompt_hash: promptHash,
    eval_scores: evalScores,
    promotion_verdict: evalScores.verdict,
    primary,
    candidate,
    request: {
      prompt,
      evidence,
    },
    trace_persisted: false,
  };

  if (config.tracePersist) {
    route.trace_persisted = await persistModelLearningTrace(route, summary, config, options);
  }
  return route;
}

function skippedModelRoute(summary, context = {}, legacy = {}, outputFormatValue = "live_line", maxChars = COMMENTARY_MAX_CHARS, reason = "model_route_skipped", options = {}) {
  const config = modelRouterConfig();
  const traceId = textValue(options.traceId || options.trace_id || options.traceID) || newTraceId(summary);
  const evidence = buildModelEvidence(summary, context || {}, legacy || {});
  const prompt = buildModelPrompt(summary, context || {}, legacy || {}, outputFormatValue, maxChars);
  const evalScores = evaluateModelOutputs(null, null, summary, config, maxChars);
  return {
    trace_id: traceId,
    route_mode: config.routeMode,
    primary_provider: config.primaryProvider,
    candidate_provider: config.candidateProvider || null,
    model_id: null,
    latency_ms: null,
    evidence_hash: compactHash(stableJson(evidence)),
    prompt_hash: compactHash(prompt),
    eval_scores: evalScores,
    promotion_verdict: evalScores.verdict,
    primary: {
      ok: false,
      provider: config.primaryProvider,
      skipped: true,
      error: reason,
    },
    candidate: config.candidateProvider ? {
      ok: false,
      provider: config.candidateProvider,
      skipped: true,
      error: reason,
    } : null,
    request: {
      prompt,
      evidence,
    },
    trace_persisted: false,
  };
}

async function runModelRouteWithinBudget(args, options = {}, timeoutMs = 0, reason = "model_route_budget_exhausted") {
  const budgetMs = Math.floor(Number(timeoutMs) || 0);
  if (budgetMs < 250) {
    return {
      route: skippedModelRoute(
        args.summary,
        args.context || {},
        args.legacy || {},
        args.outputFormatValue,
        args.maxChars,
        reason,
        options
      ),
      warning: `model_route:${reason}`,
    };
  }
  try {
    return {
      route: await withTimeout(runModelRoute(args, options), budgetMs, "model_route"),
      warning: null,
    };
  } catch (error) {
    const message = error?.message || reason;
    return {
      route: skippedModelRoute(
        args.summary,
        args.context || {},
        args.legacy || {},
        args.outputFormatValue,
        args.maxChars,
        message,
        options
      ),
      warning: `model_route:${message}`,
    };
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
  const timeoutMs = boundedMs(options.timeoutMs || config.timeoutMs, config.timeoutMs, 1, config.timeoutMs);
  const effectiveConfig = { ...config, timeoutMs };

  const login = effectiveConfig.sessionCookie
    ? { attempted: false, ok: false, cookie: "" }
    : await loginWithBasic(effectiveConfig, requestFn);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "save-the-wildlife-paf-canvas/1.0",
  };
  const cookie = effectiveConfig.sessionCookie || login.cookie;
  if (cookie) headers.Cookie = cookie;
  if (effectiveConfig.basicUsername && effectiveConfig.basicPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${effectiveConfig.basicUsername}:${effectiveConfig.basicPassword}`).toString("base64")}`;
  }

  const response = await requestFn(effectiveConfig.runEndpointUrl, {
    method: "POST",
    timeoutMs: effectiveConfig.timeoutMs,
    verifyTls: effectiveConfig.verifyTls,
    headers,
    body: JSON.stringify({
      message: buildCanvasMessage(summary, {
        inDbCommentary: options.inDbCommentary,
        context: options.context,
        outputFormat: options.outputFormat,
      }),
      roomId: effectiveConfig.roomId || null,
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
    endpoint: safeCanvasEndpoint(effectiveConfig.runEndpointUrl),
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
      { owner: config.selectAiObjectOwner, name: REPLAY_CLIPS_TABLE },
      { owner: config.selectAiObjectOwner, name: AGENT_MEMORIES_TABLE },
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

function matchIntelligenceStatements(config = matchIntelligenceConfig()) {
  return [
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE ${config.replayClipsTable} (
        clip_id VARCHAR2(128) PRIMARY KEY,
        session_id VARCHAR2(128) NOT NULL,
        room_id VARCHAR2(64),
        player_id VARCHAR2(128),
        event_type VARCHAR2(64) NOT NULL,
        event_at TIMESTAMP WITH TIME ZONE,
        clip_uri VARCHAR2(1024),
        thumbnail_uri VARCHAR2(1024),
        timecode_start_ms NUMBER,
        timecode_end_ms NUMBER,
        frame_count NUMBER,
        moderation_status VARCHAR2(32) DEFAULT ''approved'' NOT NULL,
        tags_json CLOB CHECK (tags_json IS JSON),
        metadata_json CLOB CHECK (metadata_json IS JSON),
        replay_json CLOB CHECK (replay_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE INDEX ${config.replayClipsTable}_SESSION_IX ON ${config.replayClipsTable} (session_id, event_at)';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE ${config.agentMemoriesTable} (
        memory_id VARCHAR2(160) PRIMARY KEY,
        session_id VARCHAR2(128) NOT NULL,
        room_id VARCHAR2(64),
        player_id VARCHAR2(128),
        memory_type VARCHAR2(40) DEFAULT ''session'' NOT NULL,
        score NUMBER,
        content CLOB NOT NULL,
        embedding_text CLOB,
        embedding_json CLOB CHECK (embedding_json IS JSON),
        metadata_json CLOB CHECK (metadata_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE INDEX ${config.agentMemoriesTable}_PLAYER_IX ON ${config.agentMemoriesTable} (player_id, created_at)';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
  ];
}

function learningTraceStatements() {
  return [
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE STWL_MODEL_TRACES (
        trace_id VARCHAR2(128) PRIMARY KEY,
        session_id VARCHAR2(128),
        room_id VARCHAR2(64),
        player_id VARCHAR2(128),
        run_id VARCHAR2(128),
        route_mode VARCHAR2(32),
        primary_provider VARCHAR2(64),
        candidate_provider VARCHAR2(64),
        selected_provider VARCHAR2(64),
        prompt_hash VARCHAR2(64),
        evidence_hash VARCHAR2(64),
        prompt_text CLOB,
        evidence_json CLOB CHECK (evidence_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE INDEX STWL_MODEL_TRACES_SESSION_IX ON STWL_MODEL_TRACES (session_id, player_id, created_at)';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE STWL_MODEL_OUTPUTS (
        output_id VARCHAR2(180) PRIMARY KEY,
        trace_id VARCHAR2(128) NOT NULL,
        provider VARCHAR2(64) NOT NULL,
        model_id VARCHAR2(256),
        is_primary NUMBER(1,0) DEFAULT 0 NOT NULL,
        is_candidate NUMBER(1,0) DEFAULT 0 NOT NULL,
        status VARCHAR2(32),
        latency_ms NUMBER,
        tokens NUMBER,
        finish_reason VARCHAR2(128),
        output_text CLOB,
        error_message VARCHAR2(1000),
        warnings_json CLOB CHECK (warnings_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT stwl_model_outputs_trace_fk FOREIGN KEY (trace_id) REFERENCES STWL_MODEL_TRACES(trace_id)
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE INDEX STWL_MODEL_OUTPUTS_TRACE_IX ON STWL_MODEL_OUTPUTS (trace_id, provider)';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE STWL_MODEL_EVALS (
        eval_id VARCHAR2(180) PRIMARY KEY,
        trace_id VARCHAR2(128) NOT NULL,
        rubric_version VARCHAR2(80),
        verdict VARCHAR2(40),
        scorer_notes VARCHAR2(1000),
        scores_json CLOB CHECK (scores_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT stwl_model_evals_trace_fk FOREIGN KEY (trace_id) REFERENCES STWL_MODEL_TRACES(trace_id)
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE STWL_TRAINING_EXAMPLES (
        example_id VARCHAR2(180) PRIMARY KEY,
        trace_id VARCHAR2(128) NOT NULL,
        dataset_version VARCHAR2(80),
        split VARCHAR2(32),
        redaction_status VARCHAR2(40),
        accepted NUMBER(1,0) DEFAULT 0 NOT NULL,
        example_json CLOB CHECK (example_json IS JSON),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
        CONSTRAINT stwl_training_examples_trace_fk FOREIGN KEY (trace_id) REFERENCES STWL_MODEL_TRACES(trace_id)
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
    `BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE STWL_MODEL_PROMOTIONS (
        promotion_id VARCHAR2(180) PRIMARY KEY,
        trace_id VARCHAR2(128),
        candidate_model_id VARCHAR2(256),
        adapter_uri VARCHAR2(1024),
        eval_run_id VARCHAR2(128),
        approval_state VARCHAR2(40),
        promotion_reason VARCHAR2(1000),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;`,
  ];
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

async function ensureMatchIntelligenceSchema(connection) {
  const config = matchIntelligenceConfig();
  if (!config.enabled || !config.autoInit || matchIntelligenceInitAttempted) return;
  matchIntelligenceInitAttempted = true;
  for (const statement of matchIntelligenceStatements(config)) {
    try {
      await connection.execute(statement);
    } catch (_) {
      // Match intelligence is additive; commentary must still work from STWL_GAME_EVENTS.
    }
  }
}

async function ensureLearningSchema(connection) {
  if (learningSchemaInitAttempted) return;
  learningSchemaInitAttempted = true;
  for (const statement of learningTraceStatements()) {
    try {
      await connection.execute(statement);
    } catch (_) {
      // Trace capture is additive; commentary must keep flowing if DDL is unavailable.
    }
  }
}

function modelOutputRows(route) {
  return [
    { role: "primary", output: route.primary },
    { role: "candidate", output: route.candidate },
  ].filter((item) => item.output && item.output.provider);
}

async function persistModelLearningTrace(route, summary, config, options = {}) {
  const oracle = await getOracleConnection(options);
  if (!oracle) return false;
  const { connection, close } = oracle;
  try {
    await ensureLearningSchema(connection);
    const selectedProvider = route.primary?.ok ? route.primary.provider : null;
    await connection.execute(
      `MERGE INTO STWL_MODEL_TRACES t
       USING (
         SELECT :trace_id AS trace_id,
                :session_id AS session_id,
                :room_id AS room_id,
                :player_id AS player_id,
                :run_id AS run_id,
                :route_mode AS route_mode,
                :primary_provider AS primary_provider,
                :candidate_provider AS candidate_provider,
                :selected_provider AS selected_provider,
                :prompt_hash AS prompt_hash,
                :evidence_hash AS evidence_hash,
                :prompt_text AS prompt_text,
                :evidence_json AS evidence_json
         FROM dual
       ) s
       ON (t.trace_id = s.trace_id)
       WHEN MATCHED THEN UPDATE SET
         t.selected_provider = s.selected_provider,
         t.prompt_hash = s.prompt_hash,
         t.evidence_hash = s.evidence_hash,
         t.prompt_text = s.prompt_text,
         t.evidence_json = s.evidence_json
       WHEN NOT MATCHED THEN INSERT (
         trace_id, session_id, room_id, player_id, run_id, route_mode,
         primary_provider, candidate_provider, selected_provider,
         prompt_hash, evidence_hash, prompt_text, evidence_json
       ) VALUES (
         s.trace_id, s.session_id, s.room_id, s.player_id, s.run_id, s.route_mode,
         s.primary_provider, s.candidate_provider, s.selected_provider,
         s.prompt_hash, s.evidence_hash, s.prompt_text, s.evidence_json
       )`,
      {
        trace_id: route.trace_id,
        session_id: summary.session_id || null,
        room_id: summary.room_id || null,
        player_id: summary.player_id || null,
        run_id: process.env.STWL_LOAD_RUN_ID || process.env.PAF_TRACE_RUN_ID || null,
        route_mode: route.route_mode,
        primary_provider: route.primary_provider,
        candidate_provider: route.candidate_provider,
        selected_provider: selectedProvider,
        prompt_hash: route.prompt_hash,
        evidence_hash: route.evidence_hash,
        prompt_text: route.request?.prompt || "",
        evidence_json: JSON.stringify(route.request?.evidence || {}),
      },
      { autoCommit: true }
    );

    for (const item of modelOutputRows(route)) {
      const output = item.output;
      await connection.execute(
        `MERGE INTO STWL_MODEL_OUTPUTS o
         USING (
           SELECT :output_id AS output_id,
                  :trace_id AS trace_id,
                  :provider AS provider,
                  :model_id AS model_id,
                  :is_primary AS is_primary,
                  :is_candidate AS is_candidate,
                  :status AS status,
                  :latency_ms AS latency_ms,
                  :tokens AS tokens,
                  :finish_reason AS finish_reason,
                  :output_text AS output_text,
                  :error_message AS error_message,
                  :warnings_json AS warnings_json
           FROM dual
         ) s
         ON (o.output_id = s.output_id)
         WHEN MATCHED THEN UPDATE SET
           o.status = s.status,
           o.latency_ms = s.latency_ms,
           o.tokens = s.tokens,
           o.finish_reason = s.finish_reason,
           o.output_text = s.output_text,
           o.error_message = s.error_message,
           o.warnings_json = s.warnings_json
         WHEN NOT MATCHED THEN INSERT (
           output_id, trace_id, provider, model_id, is_primary, is_candidate,
           status, latency_ms, tokens, finish_reason, output_text, error_message, warnings_json
         ) VALUES (
           s.output_id, s.trace_id, s.provider, s.model_id, s.is_primary, s.is_candidate,
           s.status, s.latency_ms, s.tokens, s.finish_reason, s.output_text, s.error_message, s.warnings_json
         )`,
        {
          output_id: `${route.trace_id}:${item.role}:${output.provider}`,
          trace_id: route.trace_id,
          provider: output.provider,
          model_id: output.model_id || null,
          is_primary: item.role === "primary" ? 1 : 0,
          is_candidate: item.role === "candidate" ? 1 : 0,
          status: output.ok ? "ok" : (output.skipped ? "skipped" : "failed"),
          latency_ms: output.latency_ms ?? null,
          tokens: output.tokens ?? null,
          finish_reason: output.finish_reason || null,
          output_text: output.text || null,
          error_message: output.error || null,
          warnings_json: JSON.stringify(output.warnings || []),
        },
        { autoCommit: true }
      );
    }

    await connection.execute(
      `MERGE INTO STWL_MODEL_EVALS e
       USING (
         SELECT :eval_id AS eval_id,
                :trace_id AS trace_id,
                :rubric_version AS rubric_version,
                :verdict AS verdict,
                :scorer_notes AS scorer_notes,
                :scores_json AS scores_json
         FROM dual
       ) s
       ON (e.eval_id = s.eval_id)
       WHEN MATCHED THEN UPDATE SET
         e.verdict = s.verdict,
         e.scorer_notes = s.scorer_notes,
         e.scores_json = s.scores_json
       WHEN NOT MATCHED THEN INSERT (
         eval_id, trace_id, rubric_version, verdict, scorer_notes, scores_json
       ) VALUES (
         s.eval_id, s.trace_id, s.rubric_version, s.verdict, s.scorer_notes, s.scores_json
       )`,
      {
        eval_id: `${route.trace_id}:${config.rubricVersion}`,
        trace_id: route.trace_id,
        rubric_version: config.rubricVersion,
        verdict: route.eval_scores?.verdict || "not_evaluated",
        scorer_notes: route.eval_scores?.reason || null,
        scores_json: JSON.stringify(route.eval_scores || {}),
      },
      { autoCommit: true }
    );

    if (config.trainingCaptureEnabled && route.candidate?.ok) {
      const accepted = route.eval_scores?.verdict === "candidate_ready" ? 1 : 0;
      await connection.execute(
        `MERGE INTO STWL_TRAINING_EXAMPLES x
         USING (
           SELECT :example_id AS example_id,
                  :trace_id AS trace_id,
                  :dataset_version AS dataset_version,
                  :split AS split,
                  :redaction_status AS redaction_status,
                  :accepted AS accepted,
                  :example_json AS example_json
           FROM dual
         ) s
         ON (x.example_id = s.example_id)
         WHEN MATCHED THEN UPDATE SET
           x.accepted = s.accepted,
           x.example_json = s.example_json,
           x.redaction_status = s.redaction_status
         WHEN NOT MATCHED THEN INSERT (
           example_id, trace_id, dataset_version, split, redaction_status, accepted, example_json
         ) VALUES (
           s.example_id, s.trace_id, s.dataset_version, s.split, s.redaction_status, s.accepted, s.example_json
         )`,
        {
          example_id: `${route.trace_id}:candidate`,
          trace_id: route.trace_id,
          dataset_version: process.env.PAF_TRAINING_DATASET_VERSION || config.rubricVersion,
          split: accepted ? "candidate" : "rejected",
          redaction_status: "metadata-only",
          accepted,
          example_json: JSON.stringify({
            prompt_hash: route.prompt_hash,
            evidence_hash: route.evidence_hash,
            provider: route.candidate.provider,
            model_id: route.candidate.model_id,
            text: route.candidate.text,
            eval: route.eval_scores,
          }),
        },
        { autoCommit: true }
      );
    }

    if (route.candidate?.model_id) {
      await connection.execute(
        `MERGE INTO STWL_MODEL_PROMOTIONS p
         USING (
           SELECT :promotion_id AS promotion_id,
                  :trace_id AS trace_id,
                  :candidate_model_id AS candidate_model_id,
                  :adapter_uri AS adapter_uri,
                  :eval_run_id AS eval_run_id,
                  :approval_state AS approval_state,
                  :promotion_reason AS promotion_reason
           FROM dual
         ) s
         ON (p.promotion_id = s.promotion_id)
         WHEN MATCHED THEN UPDATE SET
           p.approval_state = s.approval_state,
           p.promotion_reason = s.promotion_reason
         WHEN NOT MATCHED THEN INSERT (
           promotion_id, trace_id, candidate_model_id, adapter_uri,
           eval_run_id, approval_state, promotion_reason
         ) VALUES (
           s.promotion_id, s.trace_id, s.candidate_model_id, s.adapter_uri,
           s.eval_run_id, s.approval_state, s.promotion_reason
         )`,
        {
          promotion_id: `${route.trace_id}:${route.candidate.model_id}`,
          trace_id: route.trace_id,
          candidate_model_id: route.candidate.model_id,
          adapter_uri: process.env.OCI_FT_MODEL_ADAPTER_URI || null,
          eval_run_id: config.rubricVersion,
          approval_state: route.eval_scores?.verdict || "not_evaluated",
          promotion_reason: route.eval_scores?.reason || null,
        },
        { autoCommit: true }
      );
    }

    return true;
  } catch (_) {
    return false;
  } finally {
    if (close) await connection.close();
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
        room_id,
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
      GROUP BY session_id, room_id, player_id`,
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
      room_id: row.ROOM_ID,
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

async function resolveLatestOracleIdentityForRoom(connection, roomId) {
  const normalizedRoom = textValue(roomId);
  if (!normalizedRoom) return null;
  const rows = await queryOptionalRows(
    connection,
    `SELECT *
     FROM (
       SELECT
         session_id,
         room_id,
         player_id,
         MAX(player_name) KEEP (DENSE_RANK LAST ORDER BY occurred_at) AS player_name,
         MAX(occurred_at) AS last_event_at,
         NVL(MAX(score) KEEP (DENSE_RANK LAST ORDER BY occurred_at), 0) AS score,
         COUNT(*) AS event_count,
         CASE WHEN LOWER(player_id) LIKE 'bot-%' THEN 1 ELSE 0 END AS bot_rank
       FROM ${GAME_EVENTS_TABLE}
       WHERE room_id = :roomId
       GROUP BY session_id, room_id, player_id
       ORDER BY bot_rank ASC, last_event_at DESC
     )
     WHERE ROWNUM <= 1`,
    { roomId: normalizedRoom }
  );
  const row = rows?.[0];
  if (!row) return null;
  return normalizeSummary({
    session_id: row.SESSION_ID,
    room_id: row.ROOM_ID,
    player_id: row.PLAYER_ID,
    player_name: row.PLAYER_NAME,
    score: row.SCORE,
  });
}

async function queryOptionalRows(connection, sql, binds = {}) {
  try {
    const result = await connection.execute(sql, binds);
    return result.rows || [];
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/ORA-00942|ORA-04043|ORA-00904/i.test(message)) return null;
    throw error;
  }
}

async function getOracleEventEvidence(connection, sessionId, playerId, maxEvents) {
  const rows = await queryOptionalRows(
    connection,
    `SELECT *
     FROM (
       SELECT id, event_type, occurred_at, score, x, y, z,
              related_player_id, related_item_id, metadata_json
       FROM ${GAME_EVENTS_TABLE}
       WHERE session_id = :sessionId
         AND player_id = :playerId
       ORDER BY occurred_at
     )
     WHERE ROWNUM <= :maxEvents`,
    { sessionId, playerId, maxEvents }
  );
  return (rows || []).map(compactEvent);
}

async function getReplayEvidence(connection, sessionId, playerId, config) {
  if (!config.replayEnabled || config.maxReplayClips <= 0) return { clips: [], available: false };
  const rows = await queryOptionalRows(
    connection,
    `SELECT *
     FROM (
       SELECT clip_id, session_id, room_id, player_id, event_type, event_at,
              clip_uri, thumbnail_uri, timecode_start_ms, timecode_end_ms,
              frame_count, moderation_status, tags_json, metadata_json, replay_json
       FROM ${config.replayClipsTable}
       WHERE session_id = :sessionId
         AND (player_id = :playerId OR player_id IS NULL)
         AND LOWER(NVL(moderation_status, 'approved')) <> 'blocked'
       ORDER BY event_at DESC NULLS LAST, created_at DESC
     )
     WHERE ROWNUM <= :maxClips`,
    { sessionId, playerId, maxClips: config.maxReplayClips }
  );
  if (rows === null) return { clips: [], available: false };
  return { clips: rows.map(normalizeReplayClip), available: true };
}

async function getVectorMemories(connection, summary, config) {
  if (!config.vectorEnabled || config.vectorTopK <= 0) return { memories: [], available: false };
  const rows = await queryOptionalRows(
    connection,
    `SELECT *
     FROM (
       SELECT memory_id, session_id, player_id, memory_type, score, content,
              embedding_text, metadata_json, created_at
       FROM ${config.agentMemoriesTable}
       WHERE player_id = :playerId
         AND session_id <> :sessionId
       ORDER BY created_at DESC
     )
     WHERE ROWNUM <= :topK`,
    {
      sessionId: summary.session_id,
      playerId: summary.player_id,
      topK: config.vectorTopK,
    }
  );
  if (rows === null) return { memories: [], available: false };
  return { memories: rows.map(normalizeMemory), available: true };
}

async function persistSessionMemory(connection, summary, context, config) {
  if (!config.persistMemory || !summary.session_id || !summary.player_id) return false;
  const powerups = compactPowerupNames(summary.powerups);
  const content = [
    `${summary.player_name || summary.player_id || "Player"} scored ${summary.score}`,
    powerups.length ? `powerups=${powerups.join(",")}` : "",
    summary.trail_crosses ? `trail_crosses=${summary.trail_crosses}` : "",
    summary.freezes ? `freezes=${summary.freezes}` : "",
    (context.replay_clips || []).length ? `replay_clips=${context.replay_clips.length}` : "",
  ].filter(Boolean).join("; ");
  const metadata = {
    source: "save-the-wildlife-match-intelligence",
    graph_fact_count: (context.graph_facts || []).length,
    replay_clip_count: (context.replay_clips || []).length,
    powerups: summary.powerups || {},
  };
  try {
    await connection.execute(
      `MERGE INTO ${config.agentMemoriesTable} m
       USING (
         SELECT :memory_id AS memory_id,
                :session_id AS session_id,
                :room_id AS room_id,
                :player_id AS player_id,
                :score AS score,
                :content AS content,
                :embedding_text AS embedding_text,
                :metadata_json AS metadata_json
         FROM dual
       ) s
       ON (m.memory_id = s.memory_id)
       WHEN MATCHED THEN UPDATE SET
         m.score = s.score,
         m.content = s.content,
         m.embedding_text = s.embedding_text,
         m.metadata_json = s.metadata_json
       WHEN NOT MATCHED THEN INSERT (
         memory_id, session_id, room_id, player_id, memory_type, score,
         content, embedding_text, metadata_json
       ) VALUES (
         s.memory_id, s.session_id, s.room_id, s.player_id, 'session', s.score,
         s.content, s.embedding_text, s.metadata_json
       )`,
      {
        memory_id: `session:${summary.session_id}:${summary.player_id}`,
        session_id: summary.session_id,
        room_id: summary.room_id || null,
        player_id: summary.player_id,
        score: summary.score,
        content,
        embedding_text: content,
        metadata_json: JSON.stringify(metadata),
      },
      { autoCommit: true }
    );
    return true;
  } catch (_) {
    return false;
  }
}

async function buildMatchContext(body = {}, options = {}) {
  const config = matchIntelligenceConfig();
  const bodySummary = normalizeSummary(body.summary || body);
  const format = outputFormat(body.output_format || body.outputFormat || body.format);
  let summary = bodySummary;
  let source = "request-summary";
  let warning = null;
  const capabilities = {
    sql_summary: false,
    room_session_resolved: false,
    json_events: false,
    graph_facts: false,
    replay_clips: false,
    vector_memories: false,
    memory_persisted: false,
  };

  if (!config.enabled) {
    return {
      ok: true,
      source,
      output_format: format,
      summary,
      json_events: [],
      graph_facts: [],
      replay_clips: [],
      vector_memories: [],
      capabilities,
      warning: "match_intelligence_disabled",
    };
  }

  const oracle = await getOracleConnection(options);
  if (!oracle) {
    const json_events = [];
    const graph_facts = compactGraphFacts(json_events, summary);
    return {
      ok: true,
      source,
      output_format: format,
      summary,
      json_events,
      graph_facts,
      replay_clips: [],
      vector_memories: [],
      formats: buildEvidenceFormats(summary, { graph_facts }, COMMENTARY_MAX_CHARS),
      capabilities,
      warning: "oracle_not_configured",
    };
  }

  const { connection, close } = oracle;
  try {
    await ensureMatchIntelligenceSchema(connection);
    if ((!summary.session_id || !summary.player_id) && summary.room_id) {
      const resolved = await resolveLatestOracleIdentityForRoom(connection, summary.room_id);
      if (resolved?.session_id && resolved?.player_id) {
        summary = normalizeSummary({
          ...summary,
          ...resolved,
          player_name: resolved.player_name || summary.player_name,
        });
        source = "oracle-room-latest";
        capabilities.room_session_resolved = true;
      }
    }

    if (summary.session_id && summary.player_id && !options.skipOracleSummary) {
      const oracleSummary = await getOracleSummary(summary.session_id, summary.player_id, { ...options, oracleConnection: connection });
      if (oracleSummary) {
        summary = oracleSummary;
        source = "oracle-match-intelligence";
        capabilities.sql_summary = true;
      }
    }

    const json_events = summary.session_id && summary.player_id
      ? await getOracleEventEvidence(connection, summary.session_id, summary.player_id, config.maxEvents)
      : [];
    capabilities.json_events = json_events.length > 0;

    const graph_facts = config.graphEnabled ? compactGraphFacts(json_events, summary) : [];
    capabilities.graph_facts = graph_facts.length > 0;

    const replay = summary.session_id && summary.player_id
      ? await getReplayEvidence(connection, summary.session_id, summary.player_id, config)
      : { clips: [], available: false };
    capabilities.replay_clips = replay.available && replay.clips.length > 0;

    const contextBeforeMemory = {
      graph_facts,
      replay_clips: replay.clips,
    };
    capabilities.memory_persisted = await persistSessionMemory(connection, summary, contextBeforeMemory, config);

    const memory = await getVectorMemories(connection, summary, config);
    capabilities.vector_memories = memory.available && memory.memories.length > 0;

    const context = {
      ok: true,
      source,
      output_format: format,
      summary,
      json_events,
      graph_facts,
      replay_clips: replay.clips,
      vector_memories: memory.memories,
      capabilities,
      warning,
    };
    return {
      ...context,
      formats: buildEvidenceFormats(summary, context, Number(body.max_chars || body.maxChars || COMMENTARY_MAX_CHARS)),
    };
  } catch (error) {
    warning = error.message;
    return {
      ok: true,
      source,
      output_format: format,
      summary,
      json_events: [],
      graph_facts: [],
      replay_clips: [],
      vector_memories: [],
      formats: buildEvidenceFormats(summary, {}, Number(body.max_chars || body.maxChars || COMMENTARY_MAX_CHARS)),
      capabilities,
      warning,
    };
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

function buildLegacyEnvelope(summary, context = {}, { source = "request-summary", inDbAgent = null, canvas = null, maxChars = COMMENTARY_MAX_CHARS } = {}) {
  const formats = buildEvidenceFormats(summary, context || {}, maxChars);
  const baseCommentary = canvas?.commentary || inDbAgent?.commentary || formats.live_line || deterministicScript(summary, maxChars);
  const legacySource = canvas ? "paf-canvas" : inDbAgent?.source || source;
  return {
    formats,
    baseCommentary,
    legacySource,
    legacy: {
      commentary: baseCommentary,
      source: legacySource,
      inDbAgent,
      canvas,
      formats,
      latency_ms: canvas?.elapsed_ms ?? null,
    },
  };
}

function modelRouteWarnings(modelRoute = {}, { includeCandidate = true } = {}) {
  return [modelRoute.primary, modelRoute.candidate]
    .filter((item) => includeCandidate || item?.provider !== modelRoute.candidate_provider)
    .filter((item) => item && item.ok === false && !item.skipped)
    .map((item) => `${item.provider}:${item.error || "failed"}`);
}

function candidateModelRouteWarnings(modelRoute = {}) {
  const candidateProvider = modelRoute.candidate_provider;
  if (!candidateProvider) return [];
  return [modelRoute.candidate]
    .filter((item) => item?.provider === candidateProvider)
    .filter((item) => item && item.ok === false && !item.skipped)
    .map((item) => `${item.provider}:${item.error || "failed"}`);
}

function combineWarnings(...groups) {
  return groups
    .flat()
    .filter(Boolean)
    .map(String);
}

function warningString(warnings) {
  return combineWarnings(warnings).join("; ") || null;
}

function splitWarningString(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function publicModelOutput(output) {
  return output ? {
    ok: output.ok,
    provider: output.provider,
    model_id: output.model_id || null,
    text: output.text || null,
    latency_ms: output.latency_ms ?? null,
    tokens: output.tokens ?? null,
    finish_reason: output.finish_reason || null,
    warnings: Array.isArray(output.warnings) ? output.warnings : [],
    runtime_mode: output.runtime_mode || null,
    upstream_configured: output.upstream_configured,
    facts_policy: output.facts_policy || null,
    error: output.error || null,
    skipped: Boolean(output.skipped),
  } : null;
}

function contextEvidenceSummary(matchContext) {
  return matchContext ? {
    json_event_count: matchContext.json_events?.length || 0,
    graph_fact_count: matchContext.graph_facts?.length || 0,
    replay_clip_count: matchContext.replay_clips?.length || 0,
    vector_memory_count: matchContext.vector_memories?.length || 0,
    replay_clips: (matchContext.replay_clips || []).slice(0, 2),
    graph_facts: (matchContext.graph_facts || []).slice(0, 4),
    vector_memories: (matchContext.vector_memories || []).slice(0, 2),
  } : null;
}

function buildCommentaryResult({
  selectedCommentary,
  requestedOutput,
  selectedSource,
  fallbackSource,
  warning,
  modelRoute,
  inDbAgent,
  canvas,
  summary,
  formats,
  matchContext,
  maxChars,
  diagnosticWarnings = [],
}) {
  const selectedHasGrounding = Boolean(
    selectedSource && selectedSource !== "request-summary" ||
    inDbAgent ||
    canvas
  );
  const recoveredWarnings = selectedHasGrounding ? splitWarningString(warning) : [];
  const publicWarning = selectedHasGrounding ? null : warning;
  const diagnostics = {
    warnings: combineWarnings(diagnosticWarnings, recoveredWarnings),
  };
  return {
    ok: true,
    commentary: enforceCommentary(selectedCommentary, requestedOutput === "clip_title" ? 80 : maxChars),
    output_format: requestedOutput,
    source: selectedSource,
    fallback_source: fallbackSource,
    warning: publicWarning,
    diagnostics,
    warnings: diagnostics.warnings,
    trace_id: modelRoute.trace_id,
    route_mode: modelRoute.route_mode,
    primary_provider: modelRoute.primary_provider,
    candidate_provider: modelRoute.candidate_provider,
    model_id: modelRoute.model_id,
    latency_ms: modelRoute.latency_ms,
    evidence_hash: modelRoute.evidence_hash,
    prompt_hash: modelRoute.prompt_hash,
    eval_scores: modelRoute.eval_scores,
    promotion_verdict: modelRoute.promotion_verdict,
    model_route: {
      trace_id: modelRoute.trace_id,
      route_mode: modelRoute.route_mode,
      primary_provider: modelRoute.primary_provider,
      candidate_provider: modelRoute.candidate_provider,
      model_id: modelRoute.model_id,
      latency_ms: modelRoute.latency_ms,
      evidence_hash: modelRoute.evidence_hash,
      prompt_hash: modelRoute.prompt_hash,
      eval_scores: modelRoute.eval_scores,
      promotion_verdict: modelRoute.promotion_verdict,
      trace_persisted: modelRoute.trace_persisted,
      primary: publicModelOutput(modelRoute.primary),
      candidate: publicModelOutput(modelRoute.candidate),
    },
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
    formats,
    evidence: contextEvidenceSummary(matchContext),
    capabilities: matchContext?.capabilities || null,
  };
}

async function buildCommentary(body = {}, options = {}) {
  const startedAt = Number(options.startedAt || Date.now());
  const budget = commentaryBudgetConfig();
  const remainingBudgetMs = () => budget.deadlineMs - (Date.now() - startedAt);
  const maxChars = Number(body.max_chars || body.maxChars || COMMENTARY_MAX_CHARS);
  const bodySummary = normalizeSummary(body.summary || body);
  const requestedOutput = outputFormat(body.output_format || body.outputFormat || body.format);
  let summary = bodySummary;
  let source = "request-summary";
  let warning = null;
  let diagnosticWarnings = [];
  let matchContext = null;
  const matchConfig = matchIntelligenceConfig();
  const skipRoomLiveLineModelRoute = () => Boolean(
    requestedOutput === "live_line"
    && matchContext?.capabilities?.room_session_resolved
    && !boolEnv("PAF_ROOM_LIVE_LINE_MODEL_ROUTE_ENABLED", false)
  );

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

  if (matchConfig.enabled && (!summary.session_id || !summary.player_id) && summary.room_id) {
    try {
      matchContext = await withTimeout(
        buildMatchContext(
          {
            ...body,
            summary,
            output_format: requestedOutput,
            max_chars: maxChars,
          },
          options
        ),
        matchConfig.timeoutMs,
        "match_context"
      );
      if (matchContext?.summary) {
        summary = normalizeSummary(matchContext.summary);
        source = matchContext.source || source;
      }
    } catch (error) {
      warning = [warning, error.message].filter(Boolean).join("; ");
    }
  }

  if (["live_line", "post_match_recap"].includes(requestedOutput) && modelFastPathReady() && !skipRoomLiveLineModelRoute()) {
    const { formats, legacySource, legacy } = buildLegacyEnvelope(summary, matchContext || {}, {
      source,
      maxChars,
    });
    const modelBudgetMs = Math.min(
      modelRouterConfig().timeoutMs,
      Math.max(0, remainingBudgetMs() - DEFAULT_MODEL_ROUTE_RETURN_RESERVE_MS)
    );
    const modelOutcome = await runModelRouteWithinBudget(
      {
        summary,
        context: matchContext || {},
        legacy,
        outputFormatValue: requestedOutput,
        maxChars,
      },
      options,
      modelBudgetMs,
      "model_fast_path_budget_exhausted"
    );
    const modelRoute = modelOutcome.route;
    if (modelOutcome.warning) {
      diagnosticWarnings = combineWarnings(diagnosticWarnings, modelOutcome.warning);
    }
    const modelWarnings = modelRouteWarnings(modelRoute, { includeCandidate: false });
    const shadowWarnings = candidateModelRouteWarnings(modelRoute);
    const primaryGate = modelOutputGate(modelRoute.primary, summary, maxChars);
    const primaryDiagnostics = modelRoute.primary?.ok && !primaryGate.ok
      ? [`${modelRoute.primary.provider}:model_output_rejected_${primaryGate.reason}`]
      : [];
    if (modelRoute.primary?.ok && primaryGate.ok) {
      return buildCommentaryResult({
        selectedCommentary: modelRoute.primary.text,
        requestedOutput,
        selectedSource: modelRoute.primary.provider,
        fallbackSource: legacySource,
        warning: [warning, ...modelWarnings].filter(Boolean).join("; ") || null,
        diagnosticWarnings: combineWarnings(primaryDiagnostics, shadowWarnings),
        modelRoute,
        inDbAgent: null,
        canvas: null,
        summary,
        formats,
        matchContext,
        maxChars,
      });
    }
    if (modelRoute.primary?.ok && !primaryGate.ok) {
      return buildCommentaryResult({
        selectedCommentary: legacy.commentary,
        requestedOutput,
        selectedSource: legacySource,
        fallbackSource: modelRoute.primary.provider,
        warning: warning || null,
        diagnosticWarnings: combineWarnings(primaryDiagnostics, shadowWarnings),
        modelRoute,
        inDbAgent: null,
        canvas: null,
        summary,
        formats,
        matchContext,
        maxChars,
      });
    }
    if (modelWarnings.length) {
      diagnosticWarnings = combineWarnings(diagnosticWarnings, modelWarnings, shadowWarnings);
    }
  }

  if (matchConfig.enabled && !matchContext && summary.session_id && summary.player_id) {
    try {
      matchContext = await withTimeout(
        buildMatchContext(
          {
            ...body,
            summary,
            output_format: requestedOutput,
            max_chars: maxChars,
          },
          { ...options, skipOracleSummary: true }
        ),
        matchConfig.timeoutMs,
        "match_context"
      );
      if (matchContext?.summary) {
        summary = normalizeSummary(matchContext.summary);
        source = matchContext.source || source;
      }
    } catch (error) {
      warning = [warning, error.message].filter(Boolean).join("; ");
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
      if (inDbAgent?.commentary) {
        const inDbGate = evidenceFactGate(inDbAgent.commentary, summary, maxChars);
        if (!inDbGate.ok) {
          diagnosticWarnings = combineWarnings(
            diagnosticWarnings,
            `${inDbAgent.source || "oracle-ai-database-agent"}:in_db_output_rejected_${inDbGate.reason}`
          );
          inDbAgent = null;
        }
      }
    } catch (error) {
      warning = [warning, error.message].filter(Boolean).join("; ");
    }
  }

  let canvas = null;
  const canvasWarnings = [];
  const canvasRuntimeConfig = canvasConfig();
  if (canvasRuntimeConfig.runEndpointUrl) {
    try {
      const remaining = remainingBudgetMs();
      const canvasTimeoutMs = Math.floor(Math.min(
        canvasRuntimeConfig.timeoutMs,
        remaining - budget.canvasReturnReserveMs
      ));
      if (canvasTimeoutMs < budget.canvasMinTimeoutMs) {
        throw new Error(`budget_exhausted_${Math.max(0, Math.floor(remaining))}ms_remaining`);
      }
      canvas = await withTimeout(
        callPafCanvas(summary, maxChars, {
          ...options,
          timeoutMs: canvasTimeoutMs,
          inDbCommentary: inDbAgent?.commentary,
          context: matchContext,
          outputFormat: requestedOutput,
        }),
        canvasTimeoutMs,
        "paf_canvas"
      );
    } catch (error) {
      canvasWarnings.push(`paf_canvas:${error.message}`);
    }
  }

  const { formats, baseCommentary, legacySource, legacy } = buildLegacyEnvelope(summary, matchContext || {}, {
    source,
    inDbAgent,
    canvas,
    maxChars,
  });
  let modelRoute;
  let finalModelWarning = null;
  if (skipRoomLiveLineModelRoute()) {
    modelRoute = skippedModelRoute(
      summary,
      matchContext || {},
      legacy,
      requestedOutput,
      maxChars,
      "room_live_line_uses_sql_context",
      options
    );
  } else {
    const modelBudgetMs = Math.min(
      modelRouterConfig().timeoutMs,
      Math.max(0, remainingBudgetMs() - DEFAULT_MODEL_ROUTE_RETURN_RESERVE_MS)
    );
    const modelOutcome = await runModelRouteWithinBudget(
      {
        summary,
        context: matchContext || {},
        legacy,
        outputFormatValue: requestedOutput,
        maxChars,
      },
      options,
      modelBudgetMs
    );
    modelRoute = modelOutcome.route;
    finalModelWarning = modelOutcome.warning;
  }
  const primaryGate = modelOutputGate(modelRoute.primary, summary, maxChars);
  const primaryDiagnostics = modelRoute.primary?.ok && !primaryGate.ok
    ? [`${modelRoute.primary.provider}:model_output_rejected_${primaryGate.reason}`]
    : [];
  const modelCommentary = ["live_line", "post_match_recap"].includes(requestedOutput) && modelRoute.primary?.ok && primaryGate.ok
    ? modelRoute.primary.text
    : null;
  const groundedCommentary = canvas?.commentary || inDbAgent?.commentary || null;
  const selectedCommentary = groundedCommentary || modelCommentary || (
    requestedOutput === "live_line"
      ? baseCommentary
      : formats[requestedOutput] || baseCommentary
  );
  const selectedSource = canvas ? "paf-canvas" : (inDbAgent?.source || (modelCommentary ? modelRoute.primary.provider : legacySource));
  const selectedFallbackSource = canvas
    ? (inDbAgent?.source || source)
    : (inDbAgent ? (modelRoute.primary?.ok ? modelRoute.primary.provider : source) : (modelCommentary ? legacySource : (modelRoute.primary?.ok ? modelRoute.primary.provider : null)));
  const primaryModelWarnings = modelRouteWarnings(modelRoute, { includeCandidate: false });
  const shadowModelWarnings = candidateModelRouteWarnings(modelRoute);
  const hasGroundedFallback = Boolean(modelCommentary || canvas || inDbAgent || source === "oracle-sql" || matchContext);
  if (!hasGroundedFallback && canvasWarnings.length) {
    warning = warningString([warning, canvasWarnings]);
  }
  diagnosticWarnings = combineWarnings(
    diagnosticWarnings,
    finalModelWarning,
    primaryDiagnostics,
    primaryModelWarnings,
    shadowModelWarnings,
    hasGroundedFallback ? canvasWarnings : []
  );

  return buildCommentaryResult({
    selectedCommentary,
    requestedOutput,
    selectedSource,
    fallbackSource: selectedFallbackSource,
    warning,
    diagnosticWarnings,
    modelRoute,
    inDbAgent,
    canvas,
    summary,
    formats,
    matchContext,
    maxChars,
  });
}

app.get("/healthz", async (req, res) => {
  const config = canvasConfig();
  const inDbConfig = inDbAgentConfig();
  const matchConfig = matchIntelligenceConfig();
  const modelConfig = modelRouterConfig();
  const health = {
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
    match_intelligence_enabled: matchConfig.enabled,
    match_intelligence_auto_init: matchConfig.autoInit,
    graph_retrieval_enabled: matchConfig.graphEnabled,
    replay_retrieval_enabled: matchConfig.replayEnabled,
    vector_retrieval_enabled: matchConfig.vectorEnabled,
    vector_top_k: matchConfig.vectorTopK,
    replay_clips_table: matchConfig.replayClipsTable,
    agent_memories_table: matchConfig.agentMemoriesTable,
    bot_policy_schema_version: BOT_POLICY_SCHEMA_VERSION,
    bot_policy_count: buildBotPolicyCatalog().policies.length,
    model_router: {
      route_mode: modelConfig.routeMode,
      primary_provider: modelConfig.primaryProvider,
      candidate_provider: modelConfig.candidateProvider,
      base_endpoint_configured: Boolean(modelConfig.baseEndpointUrl),
      fine_tuned_endpoint_configured: Boolean(modelConfig.fineTunedEndpointUrl),
      trace_persist: modelConfig.tracePersist,
      eval_enabled: modelConfig.evalEnabled,
      fast_path_enabled: modelConfig.fastPathEnabled,
      rubric_version: modelConfig.rubricVersion,
      training_capture_enabled: modelConfig.trainingCaptureEnabled,
    },
  };
  const deep = ["1", "true", "yes"].includes(String(req.query?.deep || "").toLowerCase());
  if (deep) {
    try {
      const adapters = await modelAdapterHealth(modelConfig);
      health.model_adapters = adapters.adapters;
      health.model_adapter_summary = adapters.summary;
    } catch (error) {
      health.model_adapters = [];
      health.model_adapter_summary = summarizeAdapterHealth([]);
      health.model_adapter_error = error.message;
    }
  }
  res.json(health);
});

function prometheusLine(name, value, labels = {}) {
  const labelEntries = Object.entries(labels).filter(([, labelValue]) => labelValue != null && labelValue !== "");
  const suffix = labelEntries.length
    ? `{${labelEntries.map(([key, labelValue]) => `${key}="${String(labelValue).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
    : "";
  return `${name}${suffix} ${Number.isFinite(value) ? value : 0}`;
}

function renderPrometheusMetrics() {
  const modelConfig = modelRouterConfig();
  const lines = [
    "# HELP stwl_paf_uptime_seconds Private Agent Factory process uptime.",
    "# TYPE stwl_paf_uptime_seconds gauge",
    prometheusLine("stwl_paf_uptime_seconds", Math.round((Date.now() - pafMetrics.startedAt) / 1000)),
    "# HELP stwl_paf_commentary_requests_total Commentary requests received.",
    "# TYPE stwl_paf_commentary_requests_total counter",
    prometheusLine("stwl_paf_commentary_requests_total", pafMetrics.commentaryRequests),
    "# HELP stwl_paf_commentary_failures_total Commentary requests that failed.",
    "# TYPE stwl_paf_commentary_failures_total counter",
    prometheusLine("stwl_paf_commentary_failures_total", pafMetrics.commentaryFailures),
    "# HELP stwl_paf_context_requests_total Context requests received.",
    "# TYPE stwl_paf_context_requests_total counter",
    prometheusLine("stwl_paf_context_requests_total", pafMetrics.contextRequests),
    "# HELP stwl_paf_context_failures_total Context requests that failed.",
    "# TYPE stwl_paf_context_failures_total counter",
    prometheusLine("stwl_paf_context_failures_total", pafMetrics.contextFailures),
    "# HELP stwl_paf_model_endpoint_configured Private model route endpoint configured.",
    "# TYPE stwl_paf_model_endpoint_configured gauge",
    prometheusLine("stwl_paf_model_endpoint_configured", modelConfig.baseEndpointUrl ? 1 : 0, { provider: modelConfig.primaryProvider }),
    prometheusLine("stwl_paf_model_endpoint_configured", modelConfig.fineTunedEndpointUrl ? 1 : 0, { provider: modelConfig.candidateProvider }),
  ];
  return `${lines.join("\n")}\n`;
}

app.get("/metrics", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.end(renderPrometheusMetrics());
});

app.get("/api/context", async (req, res) => {
  pafMetrics.contextRequests++;
  try {
    res.json(await buildMatchContext(req.query));
  } catch (error) {
    pafMetrics.contextFailures++;
    res.status(500).json({ ok: false, error: "context_failed", detail: error.message });
  }
});

app.post("/api/context", async (req, res) => {
  pafMetrics.contextRequests++;
  try {
    res.json(await buildMatchContext(req.body));
  } catch (error) {
    pafMetrics.contextFailures++;
    res.status(500).json({ ok: false, error: "context_failed", detail: error.message });
  }
});

app.get("/api/bot-policies", (_req, res) => {
  res.json(buildBotPolicyCatalog());
});

app.get("/api/commentary", async (req, res) => {
  pafMetrics.commentaryRequests++;
  try {
    res.json(await buildCommentary(req.query));
  } catch (error) {
    pafMetrics.commentaryFailures++;
    res.status(500).json({ ok: false, error: "commentary_failed", detail: error.message });
  }
});

app.post("/api/commentary", async (req, res) => {
  pafMetrics.commentaryRequests++;
  try {
    res.json(await buildCommentary(req.body));
  } catch (error) {
    pafMetrics.commentaryFailures++;
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
  buildMatchContext,
  buildBotPolicyCatalog,
  buildModelPrompt,
  callPafCanvas,
  callInDbAgent,
  callModelProvider,
  canvasConfig,
  deterministicScript,
  evaluateModelOutputs,
  getOracleConnection,
  inDbAgentConfig,
  inDbPackageStatements,
  learningTraceStatements,
  matchIntelligenceConfig,
  matchIntelligenceStatements,
  modelRouterConfig,
  selectAiInitStatements,
  enforceCommentary,
  extractCanvasText,
  normalizeSummary,
  safeCanvasEndpoint,
  summarizeAdapterHealth,
  startServer,
};
