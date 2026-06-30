#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "mechanics-telemetry-paf-probe");
const PROFANITY_BLOCKLIST = ["fuck", "shit", "bitch", "bastard", "asshole", "cunt"];

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, timeout: true, error: error.message || String(error) });
      else resolve(response || { ok: true });
    });
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

function hasProfanity(text) {
  const lower = String(text || "").toLowerCase();
  return PROFANITY_BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function compactPowerups(powerups = {}) {
  return Object.fromEntries(Object.entries(powerups || {}).map(([key, value]) => [key, Number(value || 0)]));
}

function eventTypes(events = []) {
  return events.map((event) => String(event.type || event.event_type || "")).filter(Boolean);
}

function graphTypes(facts = []) {
  return facts.map((fact) => String(fact.type || "")).filter(Boolean);
}

function commentaryMentionsRecordedMechanics(text) {
  const lower = String(text || "").toLowerCase();
  return /powerup|shield|magnet|speed|boost|trail|cross|freeze|frozen/.test(lower);
}

function unsupportedMechanicMention(text, summary = {}) {
  const lower = String(text || "").toLowerCase();
  const powerups = compactPowerups(summary.powerups || {});
  const hasAnyPowerup = Object.values(powerups).some((value) => value > 0);
  const trailCrosses = Number(summary.trail_crosses || summary.trailCrosses || 0);
  const freezes = Number(summary.freezes || 0);
  const mentionsPowerup = /powerup|shield|magnet|speed|boost/.test(lower);
  const mentionsTrail = /trail|cross/.test(lower);
  const mentionsFreeze = /freeze|frozen/.test(lower);
  return Boolean(
    (mentionsPowerup && !hasAnyPowerup) ||
    (mentionsTrail && trailCrosses <= 0) ||
    (mentionsFreeze && freezes <= 0),
  );
}

function summarizeContext(context = {}) {
  const summary = context.summary || {};
  return {
    ok: context.ok,
    source: context.source,
    summary: {
      session_id: summary.session_id,
      room_id: summary.room_id,
      player_id: summary.player_id,
      player_name: summary.player_name,
      score: summary.score,
      trash_collected: summary.trash_collected,
      marine_hits: summary.marine_hits,
      trail_crosses: summary.trail_crosses,
      freezes: summary.freezes,
      powerups: compactPowerups(summary.powerups || {}),
      last_position: summary.last_position || null,
    },
    json_event_types: eventTypes(context.json_events || []),
    graph_fact_types: graphTypes(context.graph_facts || []),
    replay_clip_count: Array.isArray(context.replay_clips) ? context.replay_clips.length : 0,
    vector_memory_count: Array.isArray(context.vector_memories) ? context.vector_memories.length : 0,
    formats: context.formats || {},
  };
}

function summarizeCommentary(response = {}) {
  return {
    ok: response.ok,
    commentary: response.commentary || "",
    length: String(response.commentary || "").length,
    source: response.source || "",
    llm_generated: response.llm_generated === true || response.llm_generated === 1,
    select_ai_verified: response.select_ai_verified === true,
    generation_mode: response.generation_mode || "",
    model_id: response.model_id || response.generation_proof?.model_id || "",
    generation_proof: response.generation_proof || null,
    in_db_agent: response.in_db_agent || null,
    fallback_source: response.fallback_source || "",
    trace_id: response.trace_id || "",
    route_mode: response.route_mode || "",
    primary_provider: response.primary_provider || "",
    candidate_provider: response.candidate_provider || "",
    trace_persisted: response.trace_persisted ?? response.model_route?.trace_persisted ?? null,
    model_route: response.model_route ? {
      route_mode: response.model_route.route_mode,
      trace_persisted: response.model_route.trace_persisted,
      primary: response.model_route.primary ? {
        provider: response.model_route.primary.provider,
        ok: response.model_route.primary.ok,
        runtime_mode: response.model_route.primary.runtime_mode,
        skipped: response.model_route.primary.skipped,
        error: response.model_route.primary.error,
      } : null,
      candidate: response.model_route.candidate ? {
        provider: response.model_route.candidate.provider,
        ok: response.model_route.candidate.ok,
        runtime_mode: response.model_route.candidate.runtime_mode,
        skipped: response.model_route.candidate.skipped,
        error: response.model_route.candidate.error,
      } : null,
    } : null,
  };
}

async function connectSocket(baseUrl, events) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: false,
    timeout: 10000,
  });
  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  socket.onAny((event, payload) => {
    if ([
      "room.joined",
      "game.state",
      "commentary.pending",
      "commentary.ready",
      "server.info",
    ].includes(event)) {
      events.push({ at: Date.now(), event, payload });
      if (events.length > 160) events.shift();
    }
  });
  return socket;
}

async function joinRoom(socket, { room, playerId, playerName, sessionId }, events) {
  socket.emit("player.info.joining", {
    id: playerId,
    name: playerName,
    room,
    clientSessionId: `${playerId}-client`,
    gameplaySessionId: sessionId,
  });
  socket.emit("room.join", { id: room });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const joined = events.find((entry) => entry.event === "room.joined" && entry.payload?.id === room);
    if (joined) return { ok: true, joined: joined.payload };
    socket.emit("player.info.joining", {
      id: playerId,
      name: playerName,
      room,
      clientSessionId: `${playerId}-client`,
      gameplaySessionId: sessionId,
    });
    socket.emit("room.join", { id: room });
    await sleep(500);
  }
  return { ok: false, error: "room.joined timeout" };
}

function buildEvents({ room, sessionId, playerId, playerName, relatedPlayerId }) {
  const base = {
    room_id: room,
    roomId: room,
    session_id: sessionId,
    sessionId,
    player_id: playerId,
    playerId,
    player_name: playerName,
    playerName,
  };
  return [
    {
      ...base,
      type: "game_started",
      score: 0,
      position: { x: -12.5, y: 0, z: 4.25 },
      metadata: { qa_probe: "mechanics-telemetry-paf", stage: "start" },
    },
    {
      ...base,
      type: "position_sample",
      score: 0,
      position: { x: -9.4, y: 0, z: 3.2 },
      metadata: { heading: 0.35, speed: 2.1 },
    },
    {
      ...base,
      type: "trash_collected",
      score: 1,
      position: { x: -7.25, y: 0, z: 2.5 },
      related_item_id: "qa-trash-1",
      item_type: "trash",
      metadata: { item_type: "trash", pickup_radius: 5.2 },
    },
    {
      ...base,
      type: "powerup_collected",
      score: 1,
      position: { x: -5.5, y: 0, z: 1.75 },
      related_item_id: "qa-powerup-shield-1",
      powerup_type: "powerup_shield",
      powerupType: "powerup_shield",
      metadata: { powerup_type: "powerup_shield", item_type: "powerup_shield" },
    },
    {
      ...base,
      type: "trail_crossed",
      score: 1,
      position: { x: -3.8, y: 0, z: 0.8 },
      related_player_id: relatedPlayerId,
      relatedPlayerId,
      metadata: { trail_owner: relatedPlayerId, crossing_angle_degrees: 58 },
    },
    {
      ...base,
      type: "player_frozen",
      score: 1,
      position: { x: -3.6, y: 0, z: 0.75 },
      related_player_id: relatedPlayerId,
      relatedPlayerId,
      freeze_ms: 3000,
      freezeMs: 3000,
      metadata: { trail_owner: relatedPlayerId, freeze_ms: 3000 },
    },
    {
      ...base,
      type: "position_sample",
      score: 1,
      position: { x: -2.1, y: 0, z: 0.25 },
      metadata: { heading: 0.4, speed: 0.9, after_freeze: true },
    },
    {
      ...base,
      type: "game_over",
      score: 7,
      position: { x: 2.75, y: 0, z: -1.5 },
      metadata: { final_score: 7, qa_probe: "mechanics-telemetry-paf" },
    },
  ];
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "30000"));
  const suffix = Date.now().toString().slice(-6);
  const room = argValue("room", `QA-MECH-${suffix}`);
  const playerId = argValue("player-id", `qa-mech-player-${suffix}`);
  const playerName = argValue("player-name", `QA Mechanics ${suffix}`);
  const relatedPlayerId = argValue("related-player-id", `qa-trail-rival-${suffix}`);
  const sessionId = argValue("session-id", `${room}:${playerId}`);
  const socketEvents = [];
  const checks = [];
  let socket = null;
  let context = null;
  let commentary = null;
  let emitted = [];
  const startedAt = new Date().toISOString();

  await fs.mkdir(outputDir, { recursive: true });

  try {
    socket = await connectSocket(baseUrl, socketEvents);
    checks.push({ name: "socket connects", status: "pass" });
    const join = await joinRoom(socket, { room, playerId, playerName, sessionId }, socketEvents);
    checks.push({ name: "player joins target room", status: join.ok ? "pass" : "fail", join });

    const events = buildEvents({ room, sessionId, playerId, playerName, relatedPlayerId });
    for (const event of events) {
      const ack = await emitAck(socket, "game.event", event, 8000);
      emitted.push({ type: event.type, ack });
      await sleep(event.type === "position_sample" ? 1100 : 120);
    }
    const failedAcks = emitted.filter((entry) => entry.ack?.ok !== true);
    checks.push({
      name: "game.event accepts mechanics telemetry",
      status: failedAcks.length === 0 ? "pass" : "fail",
      emitted,
    });

    await sleep(2500);
    const payload = {
      session_id: sessionId,
      player_id: playerId,
      max_chars: 200,
      output_format: "live_line",
      require_llm: true,
    };
    context = await fetchJson(`${baseUrl}/paf/api/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, timeoutMs);
    const contextSummary = summarizeContext(context);
    const summary = contextSummary.summary || {};
    const powerups = summary.powerups || {};
    const requiredEventTypes = ["game_started", "powerup_collected", "trail_crossed", "player_frozen", "game_over"];
    const contextFailures = [];
    if (contextSummary.ok !== true) contextFailures.push("context.ok!=true");
    if (Number(summary.score) !== 7) contextFailures.push(`score=${summary.score}`);
    if (Number(summary.trash_collected || 0) < 1) contextFailures.push(`trash_collected=${summary.trash_collected}`);
    if (Number(powerups.powerup_shield || 0) < 1) contextFailures.push(`powerup_shield=${powerups.powerup_shield || 0}`);
    if (Number(summary.trail_crosses || 0) < 1) contextFailures.push(`trail_crosses=${summary.trail_crosses}`);
    if (Number(summary.freezes || 0) < 1) contextFailures.push(`freezes=${summary.freezes}`);
    if (!summary.last_position || !Number.isFinite(Number(summary.last_position.x)) || !Number.isFinite(Number(summary.last_position.z))) {
      contextFailures.push("missing numeric last_position");
    }
    for (const type of requiredEventTypes) {
      if (!contextSummary.json_event_types.includes(type)) contextFailures.push(`missing json event ${type}`);
    }
    if (!contextSummary.graph_fact_types.includes("player_collected_powerup")) contextFailures.push("missing graph fact player_collected_powerup");
    if (!contextSummary.graph_fact_types.includes("player_crossed_trail")) contextFailures.push("missing graph fact player_crossed_trail");
    if (!contextSummary.graph_fact_types.includes("player_frozen_by_trail")) contextFailures.push("missing graph fact player_frozen_by_trail");
    checks.push({
      name: "PAF context includes powerup/trail/freeze evidence",
      status: contextFailures.length ? "fail" : "pass",
      failures: contextFailures,
      context: contextSummary,
    });

    commentary = await fetchJson(`${baseUrl}/paf/api/commentary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, timeoutMs);
    const commentarySummary = summarizeCommentary(commentary);
    const text = commentarySummary.commentary || "";
    const commentaryFailures = [];
    const commentaryWarnings = [];
    if (commentarySummary.ok !== true) commentaryFailures.push("commentary.ok!=true");
    if (!text.trim()) commentaryFailures.push("missing commentary");
    if (text.length > 200) commentaryFailures.push(`commentary too long: ${text.length}`);
    if (hasProfanity(text)) commentaryFailures.push("commentary tripped profanity blocklist");
    if (unsupportedMechanicMention(text, summary)) commentaryFailures.push("commentary mentions unsupported mechanics");
    if (!new RegExp(`(^|[^\\d-])${Number(summary.score)}(?=$|[^\\d])`).test(text)) {
      commentaryFailures.push(`commentary does not state exact final score ${summary.score}`);
    }
    if (commentarySummary.source !== "select-ai") commentaryFailures.push(`source=${commentarySummary.source || "missing"}`);
    if (commentarySummary.llm_generated !== true) commentaryFailures.push("llm_generated!=true");
    if (commentarySummary.select_ai_verified !== true) commentaryFailures.push("select_ai_verified!=true");
    if (commentarySummary.generation_proof?.select_ai_verified !== true) {
      commentaryFailures.push("generation proof did not verify Select AI");
    }
    if (commentarySummary.generation_proof?.operation !== "DBMS_CLOUD_AI.GENERATE:chat") {
      commentaryFailures.push(`generation operation=${commentarySummary.generation_proof?.operation || "missing"}`);
    }
    if (commentarySummary.generation_proof?.output_rewritten !== false) {
      commentaryFailures.push("Select AI output was rewritten");
    }
    if (!Number.isFinite(Number(commentarySummary.generation_proof?.latency_ms))) {
      commentaryFailures.push("Select AI generation latency is missing");
    }
    if (!commentaryMentionsRecordedMechanics(text)) {
      commentaryWarnings.push("commentary did not mention recorded powerup/trail/freeze mechanics");
    }
    checks.push({
      name: "PAF commentary is unmodified Select AI output, bounded, and mechanics-aware",
      status: commentaryFailures.length ? "fail" : (commentaryWarnings.length ? "warn" : "pass"),
      failures: commentaryFailures,
      warnings: commentaryWarnings,
      commentary: commentarySummary,
    });
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
  } finally {
    try { if (socket) socket.disconnect(); } catch (_) {}
  }

  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  const result = {
    status: failed.length ? "fail" : (warned.length ? "warn" : "pass"),
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    sessionId,
    playerId,
    playerName,
    relatedPlayerId,
    checks,
    emitted,
    context: summarizeContext(context || {}),
    commentary: summarizeCommentary(commentary || {}),
    socketEvents,
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Mechanics Telemetry PAF Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Session: \`${sessionId}\``,
    `- Player: \`${playerId}\``,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status === "fail") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
