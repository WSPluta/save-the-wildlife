const DEFAULT_POWERUP_TYPES = [
  "powerup_speed",
  "powerup_shield",
  "powerup_magnet",
  "powerup_freeze",
];

export const BOT_POLICY_SCHEMA_VERSION = "stwl.bot-policy.v1";
const DEFAULT_POLICY_PRIORITIES = ["trash", "powerup_shield", "powerup_freeze", "powerup_magnet"];
const VALID_TARGET_PRIORITIES = new Set([
  "trash",
  "marine",
  "powerup",
  ...DEFAULT_POWERUP_TYPES,
]);
const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);
const PROFANITY_PATTERN = /\b(fuck|shit|bitch|asshole|bastard|dick|cunt)\b/i;

export const DEFAULT_BOT_POLICIES = [
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

function intValue(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function floatValue(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function boolValue(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function textValue(value, fallback = "") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function slugValue(value, fallback) {
  const slug = textValue(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function clamp01(value, fallback) {
  return floatValue(value, fallback, { min: 0, max: 1 });
}

function stageSafeText(value, fallback, maxLength) {
  const text = textValue(value, fallback).replace(/\s+/g, " ");
  if (PROFANITY_PATTERN.test(text)) return fallback.slice(0, maxLength);
  return text.slice(0, maxLength);
}

function normalizeTargetPriority(value, fallback = DEFAULT_POLICY_PRIORITIES) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const priority = raw
    .map((entry) => String(entry || "").trim().toLowerCase())
    .map((entry) => entry.startsWith("shield") ? "powerup_shield" : entry)
    .filter((entry) => VALID_TARGET_PRIORITIES.has(entry));
  return priority.length ? [...new Set(priority)].slice(0, 6) : fallback.slice();
}

export function normalizeBotPolicy(value = {}, fallback = DEFAULT_BOT_POLICIES[0]) {
  const sourcePolicy = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_BOT_POLICIES[0];
  const risk = String(sourcePolicy.risk || base.risk || "medium").toLowerCase();
  return {
    id: slugValue(sourcePolicy.id || base.id, "bot-policy-v1"),
    name: stageSafeText(sourcePolicy.name || base.name, "PAF Bot Policy", 48),
    source: textValue(sourcePolicy.source || base.source, "paf").slice(0, 24),
    version: textValue(sourcePolicy.version || base.version, "1.0.0").slice(0, 24),
    targetPriority: normalizeTargetPriority(sourcePolicy.targetPriority || sourcePolicy.target_priority, base.targetPriority || DEFAULT_POLICY_PRIORITIES),
    risk: VALID_RISK_LEVELS.has(risk) ? risk : "medium",
    aggression: clamp01(sourcePolicy.aggression, Number.isFinite(Number(base.aggression)) ? Number(base.aggression) : 0.35),
    throttle: floatValue(sourcePolicy.throttle, Number.isFinite(Number(base.throttle)) ? Number(base.throttle) : 0.82, { min: 0.15, max: 1 }),
    notes: stageSafeText(sourcePolicy.notes || base.notes, "Approved deterministic bot policy.", 180),
  };
}

export function parseBotPolicies(value, fallback = DEFAULT_BOT_POLICIES) {
  if (Array.isArray(value)) {
    return value.map((policy, index) => normalizeBotPolicy(policy, fallback[index % fallback.length])).slice(0, 12);
  }
  if (value && typeof value === "object") {
    const policies = Array.isArray(value.policies) ? value.policies : [];
    return policies.length
      ? policies.map((policy, index) => normalizeBotPolicy(policy, fallback[index % fallback.length])).slice(0, 12)
      : fallback.map((policy) => normalizeBotPolicy(policy));
  }
  const text = textValue(value);
  if (!text) return fallback.map((policy) => normalizeBotPolicy(policy));
  try {
    const parsed = JSON.parse(text);
    const policies = Array.isArray(parsed) ? parsed : parsed?.policies;
    if (!Array.isArray(policies) || !policies.length) return fallback.map((policy) => normalizeBotPolicy(policy));
    return policies.map((policy, index) => normalizeBotPolicy(policy, fallback[index % fallback.length])).slice(0, 12);
  } catch (_) {
    return fallback.map((policy) => normalizeBotPolicy(policy));
  }
}

export function botPolicyForIndex(index, policies = DEFAULT_BOT_POLICIES) {
  const catalog = parseBotPolicies(policies);
  return normalizeBotPolicy(catalog[Math.max(0, Number(index || 1) - 1) % catalog.length]);
}

export function normalizeRoom(value, fallback = "ROOM-0001") {
  const cleaned = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_]/g, "")
    .slice(0, 24);
  return cleaned || fallback;
}

export function parseBotConfig(env = process.env) {
  const targetPlayers = intValue(env.BOT_TARGET_PLAYERS ?? env.TARGET_PLAYERS, 8, { min: 1, max: 2000 });
  const minBots = intValue(env.BOT_MIN_BOTS, 4, { min: 0, max: 2000 });
  const maxBots = intValue(env.BOT_MAX_BOTS ?? env.MAX_BOTS, 12, { min: 1, max: 5000 });
  return {
    roomId: normalizeRoom(env.BOT_ROOM_ID || env.ROOM_DEFAULT_ID || env.ROOM_ID, "ROOM-0001"),
    targetPlayers,
    minBots: Math.min(minBots, maxBots),
    maxBots,
    traceRateMs: intValue(env.BOT_TRACE_RATE_MS || env.TRACE_RATE_IN_MILLIS, 50, { min: 20, max: 1000 }),
    positionEventIntervalMs: intValue(env.BOT_POSITION_EVENT_INTERVAL_MS, 2500, { min: 250, max: 60000 }),
    mechanicsEventIntervalMs: intValue(env.BOT_MECHANICS_EVENT_INTERVAL_MS, 6500, { min: 1000, max: 120000 }),
    gameOverDelayMs: intValue(env.BOT_GAME_OVER_DELAY_MS, 1500, { min: 0, max: 60000 }),
    collisionRadius: floatValue(env.BOT_COLLISION_RADIUS, 1.15, { min: 0.2, max: 5 }),
    targetRefreshMs: intValue(env.BOT_TARGET_REFRESH_MS, 1200, { min: 100, max: 10000 }),
    maxSteer: floatValue(env.BOT_MAX_STEER, 1, { min: 0.1, max: 1 }),
    throttle: floatValue(env.BOT_THROTTLE, 0.82, { min: 0.05, max: 1 }),
    acceleration: floatValue(env.BOT_ACCELERATION, 5.2, { min: 0.1, max: 20 }),
    friction: floatValue(env.BOT_FRICTION, 1.2, { min: 0, max: 10 }),
    maxSpeed: floatValue(env.BOT_MAX_SPEED, 2.7, { min: 0.1, max: 8 }),
    turnSpeed: floatValue(env.BOT_TURN_SPEED, 0.62, { min: 0.05, max: 3 }),
    worldHalfWidth: floatValue(env.BOT_WORLD_HALF_WIDTH, 48, { min: 5, max: 500 }),
    worldHalfHeight: floatValue(env.BOT_WORLD_HALF_HEIGHT, 48, { min: 5, max: 500 }),
    spawnFanoutRadius: floatValue(env.BOT_SPAWN_FANOUT_RADIUS, 7.5, { min: 0, max: 30 }),
    eventGeneration: boolValue(env.BOT_GENERATE_GAME_EVENTS, true),
    emitSyntheticMechanics: boolValue(env.BOT_SYNTHETIC_MECHANICS_EVENTS, true),
    scaleDownGraceMs: intValue(env.BOT_SCALE_DOWN_GRACE_MS, 15000, { min: 0, max: 300000 }),
    scaleDownCooldownMs: intValue(env.BOT_SCALE_DOWN_COOLDOWN_MS, 2500, { min: 0, max: 60000 }),
    botNamePrefix: String(env.BOT_NAME_PREFIX || "Bot Data").trim() || "Bot Data",
    sessionPrefix: String(env.BOT_SESSION_PREFIX || "BOT-DATA").trim() || "BOT-DATA",
    botPolicyUrl: String(env.BOT_POLICY_URL || env.PAF_BOT_POLICY_URL || "").trim(),
    botPolicies: parseBotPolicies(env.BOT_POLICIES_JSON || env.BOT_POLICY_JSON),
  };
}

export function desiredBotCount(counts = {}, config = parseBotConfig({})) {
  const humans = Number.isFinite(Number(counts.humans))
    ? Number(counts.humans)
    : Math.max(0, Number(counts.total || 0) - Number(counts.bots || 0));
  const wantedForTarget = Math.max(0, Number(config.targetPlayers || 0) - humans);
  const wanted = Math.max(Number(config.minBots || 0), wantedForTarget);
  return Math.max(0, Math.min(Number(config.maxBots || 0), wanted));
}

export function planBotPoolSize(currentSize, desired, state = {}, config = parseBotConfig({}), now = Date.now()) {
  const current = Math.max(0, Math.floor(Number(currentSize || 0)));
  const wanted = Math.max(0, Math.floor(Number(desired || 0)));
  const nextState = {
    scaleDownPendingSince: state.scaleDownPendingSince || 0,
    lastScaleDownAt: state.lastScaleDownAt || 0,
  };

  if (wanted >= current) {
    nextState.scaleDownPendingSince = 0;
    return { size: wanted, state: nextState, reason: wanted > current ? "scale_up" : "stable" };
  }

  if (!nextState.scaleDownPendingSince) {
    nextState.scaleDownPendingSince = now;
    return { size: current, state: nextState, reason: "scale_down_pending" };
  }

  const graceElapsed = now - nextState.scaleDownPendingSince >= Number(config.scaleDownGraceMs || 0);
  const cooldownElapsed = now - nextState.lastScaleDownAt >= Number(config.scaleDownCooldownMs || 0);
  if (!graceElapsed || !cooldownElapsed) {
    return { size: current, state: nextState, reason: "scale_down_debounced" };
  }

  nextState.lastScaleDownAt = now;
  if (current - 1 <= wanted) nextState.scaleDownPendingSince = 0;
  return { size: Math.max(wanted, current - 1), state: nextState, reason: "scale_down" };
}

export function itemKind(item = {}) {
  const type = String(item.type || item.itemType || "").toLowerCase();
  if (type.startsWith("powerup")) return "powerup";
  if (type === "turtle" || type === "marine" || type === "marine_life") return "marine";
  if (type === "trash") return "trash";
  return "unknown";
}

export function normalizeItems(items = {}) {
  return Object.entries(items || {})
    .map(([id, item]) => ({
      id,
      ...item,
      kind: itemKind(item),
      position: {
        x: Number(item?.position?.x ?? item?.x ?? 0),
        y: Number(item?.position?.y ?? item?.y ?? 0),
        z: Number(item?.position?.z ?? item?.z ?? 0),
      },
    }))
    .filter((item) => Number.isFinite(item.position.x) && Number.isFinite(item.position.z));
}

function targetPriorityRank(item, preferences = []) {
  const type = String(item.type || item.itemType || "").toLowerCase();
  const kind = item.kind || itemKind(item);
  const rank = preferences.findIndex((entry) => entry === kind || entry === type);
  return rank < 0 ? Number.POSITIVE_INFINITY : rank;
}

export function selectTargetItem(position, items, preferences = ["powerup", "trash", "marine"], options = {}) {
  const priority = normalizeTargetPriority(preferences, ["powerup", "trash", "marine"]);
  const candidates = normalizeItems(items).filter((item) => Number.isFinite(targetPriorityRank(item, priority)));
  if (!candidates.length) return null;
  const weight = { powerup: 0.4, trash: 1, marine: 1.35 };
  const ranked = candidates.map((item) => {
    const dx = item.position.x - position.x;
    const dz = item.position.z - position.z;
    const distance = Math.hypot(dx, dz);
    const jitter = Number(options.jitter || 0) * stableUnitValue(item.id || `${item.position.x}:${item.position.z}`);
    const priorityRank = targetPriorityRank(item, priority);
    const priorityWeight = 1 + (priorityRank * 0.38);
    const riskBias = options.risk === "high" && item.kind === "marine" ? 0.85 : 1;
    const score = distance * (weight[item.kind] || 1.5) * priorityWeight * riskBias + jitter;
    return { ...item, distance, score };
  }).sort((a, b) => a.score - b.score);
  const pickWindow = Math.max(1, Math.min(ranked.length, Number(options.pickWindow || 5)));
  const rankOffset = Math.max(0, Number(options.rankOffset || 0));
  return ranked[rankOffset % pickWindow];
}

function stableUnitValue(value) {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

function wrapAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function computeInputToward(position, rotationY, target, config = parseBotConfig({})) {
  if (!target?.position) {
    return { throttle: 0.35, steer: 0.25, brake: false };
  }
  const dx = target.position.x - position.x;
  const dz = target.position.z - position.z;
  const desiredYaw = Math.atan2(dx, dz);
  const delta = wrapAngle(desiredYaw - Number(rotationY || 0));
  const steer = Math.max(-config.maxSteer, Math.min(config.maxSteer, delta / 0.9));
  const throttle = Math.abs(delta) > 2.3 ? Math.max(0.25, config.throttle * 0.45) : config.throttle;
  return { throttle, steer, brake: false };
}

export function effectiveBotConfigForPolicy(config = parseBotConfig({}), policy = DEFAULT_BOT_POLICIES[0]) {
  const normalized = normalizeBotPolicy(policy);
  return {
    ...config,
    throttle: normalized.throttle,
  };
}

export function integrateBotMotion(bot, input, config = parseBotConfig({}), dtSeconds) {
  if (!bot || !input) return bot;
  const dt = Number.isFinite(dtSeconds)
    ? Math.max(0.001, Math.min(0.25, dtSeconds))
    : Math.max(0.001, Math.min(0.25, Number(config.traceRateMs || 50) / 1000));
  const throttle = Math.max(-1, Math.min(1, Number(input.throttle || 0)));
  const steer = Math.max(-1, Math.min(1, Number(input.steer || 0)));
  const speed = Number(bot.speed || 0);
  const acceleration = Number(config.acceleration || 5.2);
  const friction = Number(config.friction || 1.2);
  const maxSpeed = Number(config.maxSpeed || 2.7);
  if (throttle > 0) {
    bot.speed = speed + acceleration * throttle * dt;
  } else if (throttle < 0) {
    bot.speed = speed + acceleration * throttle * dt * 0.55;
  } else {
    bot.speed = speed * Math.exp(-friction * dt);
  }
  bot.speed = Math.max(-maxSpeed * 0.45, Math.min(maxSpeed, Number(bot.speed || 0)));
  bot.rotationY = wrapAngle(Number(bot.rotationY || 0) + Number(config.turnSpeed || 0.62) * steer * dt);
  bot.position = bot.position || { x: 0, y: 0, z: 0 };
  bot.position.x += Math.sin(bot.rotationY) * bot.speed * dt;
  bot.position.z += Math.cos(bot.rotationY) * bot.speed * dt;
  const halfW = Number(config.worldHalfWidth || 48);
  const halfH = Number(config.worldHalfHeight || 48);
  bot.position.x = Math.max(-halfW, Math.min(halfW, bot.position.x));
  bot.position.z = Math.max(-halfH, Math.min(halfH, bot.position.z));
  return bot;
}

export function buildTrace(botId, position, rotationY) {
  return {
    id: botId,
    x: Number(position.x || 0).toFixed(5),
    z: Number(position.z || 0).toFixed(5),
    rotY: Number(rotationY || 0).toFixed(5),
  };
}

export function buildGameEvent(type, bot, overrides = {}) {
  const position = overrides.position || bot.position || { x: 0, y: 0, z: 0 };
  const metadata = {
    source: "bot_simulation",
    bot_strategy: bot.strategy || "data_generation",
    bot_policy_id: bot.policy?.id || null,
    bot_policy_name: bot.policy?.name || null,
    bot_policy_source: bot.policy?.source || null,
    bot_policy_version: bot.policy?.version || null,
    bot_objective: bot.policy?.notes || null,
    ...overrides.metadata,
  };
  return {
    sessionId: bot.sessionId,
    roomId: bot.roomId,
    playerId: bot.id,
    playerName: bot.name,
    type,
    score: overrides.score ?? bot.score ?? 0,
    position: {
      x: Number(position.x || 0),
      y: Number(position.y || 0),
      z: Number(position.z || 0),
    },
    relatedPlayerId: overrides.relatedPlayerId,
    itemId: overrides.itemId,
    powerupType: overrides.powerupType,
    freezeMs: overrides.freezeMs,
    metadata,
  };
}

export function syntheticMechanicForTick(bot, tick) {
  const variant = tick % 4;
  const rival = bot.lastNearbyPlayerId || `bot-rival-${(tick % 5) + 1}`;
  if (variant === 0) {
    return buildGameEvent("trail_crossed", bot, {
      relatedPlayerId: rival,
      metadata: { trail_segment_id: `bot-seg-${bot.shortId}-${tick}` },
    });
  }
  if (variant === 1) {
    return buildGameEvent("player_frozen", bot, {
      relatedPlayerId: rival,
      freezeMs: 2500,
    });
  }
  const powerupType = DEFAULT_POWERUP_TYPES[tick % DEFAULT_POWERUP_TYPES.length];
  return buildGameEvent("powerup_collected", bot, {
    itemId: `bot-sim-power-${bot.shortId}-${tick}`,
    powerupType,
    metadata: { item_type: powerupType, synthetic_reason: "training_coverage" },
  });
}
