#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_SESSION_ID = "SMOKE-INDB-20260610-02";
const DEFAULT_PLAYER_ID = "P-SMOKE";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "conference-preflight");
const REQUIRED_HEALTH_FLAGS = [
  "ok",
  "oracle_configured",
  "genai_configured",
  "canvas_configured",
  "canvas_auth_configured",
  "indb_agent_enabled",
  "select_ai_auto_init",
  "match_intelligence_enabled",
  "graph_retrieval_enabled",
  "replay_retrieval_enabled",
  "vector_retrieval_enabled",
];
const REQUIRED_EVENT_TYPES = [
  "game_started",
  "powerup_collected",
  "trail_crossed",
  "player_frozen",
  "game_over",
];
const PROFANITY_BLOCKLIST = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "cunt",
];

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function makeCheck(name, status, details = {}) {
  return { name, status, ...details };
}

function compactError(error) {
  if (!error) return "";
  return error.stack || error.message || String(error);
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options, timeoutMs) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return JSON.parse(text);
}

async function checkGame(baseUrl, timeoutMs) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/`, { method: "HEAD" }, timeoutMs);
    if (!response.ok) {
      return makeCheck("game-url", "fail", { statusCode: response.status });
    }
    return makeCheck("game-url", "pass", {
      statusCode: response.status,
      contentType: response.headers.get("content-type") || "",
      etag: response.headers.get("etag") || "",
    });
  } catch (error) {
    return makeCheck("game-url", "fail", { error: compactError(error) });
  }
}

async function checkHealth(baseUrl, timeoutMs) {
  try {
    const health = await fetchJson(`${baseUrl}/paf/healthz`, {}, timeoutMs);
    const router = health.model_router || {};
    const selectAiFastPath = health.live_line_fast_return === true
      && health.oracle_configured === true
      && health.indb_agent_enabled === true
      && health.select_ai_auto_init === true;
    const failures = [];
    const warnings = [];
    for (const flag of REQUIRED_HEALTH_FLAGS) {
      if (health[flag] === true) continue;
      if (flag === "genai_configured" && selectAiFastPath) {
        warnings.push("genai_configured!=true; current demo contract uses Select AI fast path");
      } else {
        failures.push(`${flag}!=true`);
      }
    }
    if (router.route_mode !== "shadow") {
      if (selectAiFastPath && router.route_mode === "primary") {
        warnings.push("route_mode=primary; Select AI fast path is intentionally latency-first");
      } else {
        failures.push(`route_mode=${router.route_mode || "missing"}`);
      }
    }
    if (router.primary_provider !== "oci-base") failures.push(`primary_provider=${router.primary_provider || "missing"}`);
    if (router.candidate_provider !== "oci-fine-tuned") failures.push(`candidate_provider=${router.candidate_provider || "missing"}`);
    if (router.trace_persist !== true) {
      if (selectAiFastPath) {
        warnings.push("trace_persist!=true; trace ids and hashes are returned, persistence is a caveat");
      } else {
        failures.push("trace_persist!=true");
      }
    }
    if (router.eval_enabled !== true) failures.push("eval_enabled!=true");
    if (router.training_capture_enabled !== true) failures.push("training_capture_enabled!=true");
    return makeCheck("paf-health", failures.length ? "fail" : (warnings.length ? "warn" : "pass"), {
      failures,
      warnings,
      version: health.version,
      select_ai_profile: health.select_ai_profile,
      select_ai_model: health.select_ai_model,
      fast_path: selectAiFastPath,
      live_line_fast_return: health.live_line_fast_return === true,
      canvas_configured: health.canvas_configured === true,
      indb_agent_enabled: health.indb_agent_enabled === true,
      router,
    });
  } catch (error) {
    return makeCheck("paf-health", "fail", { error: compactError(error) });
  }
}

function summarizeEvidence(context) {
  const summary = context.summary || {};
  const powerups = summary.powerups || {};
  return {
    source: context.source,
    player_name: summary.player_name,
    score: summary.score,
    trail_crosses: summary.trail_crosses,
    freezes: summary.freezes,
    powerup_shield: powerups.powerup_shield || 0,
    last_position: summary.last_position || null,
    json_event_types: (context.json_events || []).map((event) => event.type),
    graph_facts: (context.graph_facts || []).map((fact) => fact.type),
    replay_clip_count: (context.replay_clips || []).length,
    vector_memory_count: (context.vector_memories || []).length,
    capabilities: context.capabilities || {},
  };
}

async function checkContext(baseUrl, payload, timeoutMs) {
  try {
    const context = await fetchJson(`${baseUrl}/paf/api/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, timeoutMs);
    const evidence = summarizeEvidence(context);
    const failures = [];
    const warnings = [];
    if (context.ok !== true) failures.push("ok!=true");
    if (context.warning != null) failures.push(`warning=${context.warning}`);
    if (context.source !== "oracle-match-intelligence") failures.push(`source=${context.source || "missing"}`);
    if (!context.summary) failures.push("missing summary");
    if (!Number.isFinite(Number(evidence.score))) failures.push("summary.score is not numeric");
    if ((evidence.trail_crosses || 0) < 1) failures.push("expected at least one trail crossing");
    if ((evidence.freezes || 0) < 1) failures.push("expected at least one freeze");
    if ((evidence.powerup_shield || 0) < 1) failures.push("expected powerup_shield evidence");
    if (!evidence.last_position || !Number.isFinite(Number(evidence.last_position.x)) || !Number.isFinite(Number(evidence.last_position.z))) {
      failures.push("missing numeric last_position coordinates");
    }
    const eventTypes = new Set(evidence.json_event_types);
    for (const type of REQUIRED_EVENT_TYPES) {
      if (!eventTypes.has(type)) failures.push(`missing json event ${type}`);
    }
    if (!evidence.graph_facts.length) failures.push("missing graph facts");
    if (evidence.replay_clip_count === 0) warnings.push("smoke session has no replay clips; do not claim replay caption evidence for this call");
    if (evidence.vector_memory_count === 0) warnings.push("smoke session has no vector memories; explain vector as enabled path, not returned evidence");
    return makeCheck("match-context", failures.length ? "fail" : (warnings.length ? "warn" : "pass"), {
      failures,
      warnings,
      evidence,
    });
  } catch (error) {
    return makeCheck("match-context", "fail", { error: compactError(error) });
  }
}

function hasProfanity(text) {
  const lower = String(text || "").toLowerCase();
  return PROFANITY_BLOCKLIST.some((word) => new RegExp(`\\b${word}\\b`, "i").test(lower));
}

function collectRuntimeModes(route = {}) {
  const modes = {};
  if (route.primary?.provider) modes[route.primary.provider] = route.primary.runtime_mode || "missing";
  if (route.candidate?.provider) modes[route.candidate.provider] = route.candidate.runtime_mode || "missing";
  return modes;
}

async function checkCommentary(baseUrl, payload, timeoutMs) {
  try {
    const response = await fetchJson(`${baseUrl}/paf/api/commentary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, timeoutMs);
    const failures = [];
    const warnings = [];
    const commentary = String(response.commentary || "");
    const route = response.model_route || {};
    const runtimeModes = collectRuntimeModes(route);
    const selectAiFastResponse = response.source === "select-ai"
      && response.in_db_agent?.configured === true
      && (route.primary?.error === "live_line_select_ai_first" || route.candidate?.error === "live_line_select_ai_first");
    if (response.ok !== true) failures.push("ok!=true");
    if (response.warning != null) failures.push(`warning=${response.warning}`);
    if (!commentary.trim()) failures.push("missing commentary");
    if (commentary.length > Number(payload.max_chars || 200)) failures.push(`commentary too long: ${commentary.length}`);
    if (hasProfanity(commentary)) failures.push("commentary tripped profanity blocklist");
    if (!response.source) failures.push("missing source");
    if (!response.fallback_source) warnings.push("missing fallback_source metadata");
    if (response.route_mode !== "shadow") {
      if (selectAiFastResponse && response.route_mode === "primary") {
        warnings.push("route_mode=primary under Select AI fast path; do not claim shadow evaluation for this line");
      } else {
        failures.push(`route_mode=${response.route_mode || "missing"}`);
      }
    }
    if (response.primary_provider !== "oci-base") failures.push(`primary_provider=${response.primary_provider || "missing"}`);
    if (response.candidate_provider !== "oci-fine-tuned") failures.push(`candidate_provider=${response.candidate_provider || "missing"}`);
    if (route.trace_persisted !== true) {
      if (selectAiFastResponse) {
        warnings.push("trace_persisted!=true; response carries trace_id/evidence_hash/prompt_hash but persistence is a caveat");
      } else {
        failures.push("trace_persisted!=true");
      }
    }
    if (!response.summary) failures.push("missing summary");
    if (!response.trace_id) failures.push("missing trace_id");
    if (!response.evidence_hash) failures.push("missing evidence_hash");
    if (!response.prompt_hash) failures.push("missing prompt_hash");
    if (response.canvas == null) warnings.push("canvas=null for this smoke response; do not claim Canvas produced this exact line");
    if (response.in_db_agent == null) warnings.push("in_db_agent=null for this smoke response; describe in-db agent as configured/fallback path unless metadata changes");
    for (const [provider, mode] of Object.entries(runtimeModes)) {
      if (mode !== "upstream-llm") {
        warnings.push(`${provider} runtime_mode=${mode}; this smoke response did not include a completed upstream route for that provider`);
      }
    }
    return makeCheck("commentary", failures.length ? "fail" : (warnings.length ? "warn" : "pass"), {
      failures,
      warnings,
      commentary,
      commentary_length: commentary.length,
      source: response.source,
      fallback_source: response.fallback_source,
      fast_path: selectAiFastResponse,
      route_mode: response.route_mode,
      primary_provider: response.primary_provider,
      candidate_provider: response.candidate_provider,
      runtime_modes: runtimeModes,
      canvas: response.canvas,
      in_db_agent: response.in_db_agent,
      trace_id: response.trace_id,
      trace_persisted: route.trace_persisted === true,
      promotion_verdict: response.promotion_verdict,
    });
  } catch (error) {
    return makeCheck("commentary", "fail", { error: compactError(error) });
  }
}

function runProofBundle(skipProof) {
  if (skipProof) {
    return makeCheck("model-proof-bundle", "warn", {
      skipped: true,
      warnings: ["model proof skipped by --skip-proof"],
    });
  }
  const result = spawnSync("npm", ["run", "check:model-ai-demo:proof"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const failures = [];
  if (result.error) failures.push(compactError(result.error));
  if (result.status !== 0) failures.push(`exit=${result.status}`);
  if (!output.includes("adapter_verdict=ready_with_upstream_llm_blocker") && !output.includes("adapter_verdict=ready")) {
    failures.push("adapter verdict was not ready/ready_with_upstream_llm_blocker");
  }
  if (!output.includes("strict_verdict=failed") && !output.includes("strict_verdict=ready")) {
    failures.push("strict verdict was neither failed nor ready");
  }
  if (!output.includes("proof_bundle=.codex_tmp/model-ai-readiness/proof-bundle.md")) {
    failures.push("proof bundle path missing from output");
  }
  const strictExpected = output.includes("strict_verdict=failed");
  return makeCheck("model-proof-bundle", failures.length ? "fail" : "pass", {
    failures,
    strict_expected_blocker: strictExpected,
    output,
  });
}

function finalVerdict(checks) {
  if (checks.some((check) => check.status === "fail")) return "failed";
  if (checks.some((check) => check.status === "warn")) return "ready_with_caveats";
  return "ready";
}

function renderDetails(check) {
  if (check.name === "game-url") {
    return [
      `- Status: ${check.statusCode || "unknown"}`,
      check.etag ? `- ETag: ${check.etag}` : null,
    ].filter(Boolean);
  }
  if (check.name === "paf-health") {
    return [
      `- Version: ${check.version || "unknown"}`,
      `- Select AI: ${check.select_ai_profile || "unknown"} / ${check.select_ai_model || "unknown"}`,
      `- Fast path: ${check.fast_path ? "yes" : "no"}`,
      `- Canvas configured: ${check.canvas_configured ? "yes" : "no"}`,
      `- In-db agent enabled: ${check.indb_agent_enabled ? "yes" : "no"}`,
      `- Router: ${check.router?.route_mode || "unknown"} ${check.router?.primary_provider || "unknown"} -> ${check.router?.candidate_provider || "unknown"}`,
    ];
  }
  if (check.name === "match-context") {
    const ev = check.evidence || {};
    return [
      `- Source: ${ev.source || "unknown"}`,
      `- Player: ${ev.player_name || "unknown"}, score ${ev.score ?? "unknown"}`,
      `- Mechanics: shield ${ev.powerup_shield || 0}, trail crossings ${ev.trail_crosses || 0}, freezes ${ev.freezes || 0}`,
      `- Last position: ${ev.last_position ? JSON.stringify(ev.last_position) : "missing"}`,
      `- JSON events: ${(ev.json_event_types || []).join(", ") || "none"}`,
      `- Graph facts: ${(ev.graph_facts || []).join(", ") || "none"}`,
      `- Replay clips: ${ev.replay_clip_count || 0}`,
      `- Vector memories: ${ev.vector_memory_count || 0}`,
    ];
  }
  if (check.name === "commentary") {
    return [
      `- Commentary: ${check.commentary ? `"${check.commentary}"` : "missing"}`,
      `- Length: ${check.commentary_length ?? "unknown"}`,
      `- Source: ${check.source || "unknown"}; fallback: ${check.fallback_source || "unknown"}`,
      `- Fast path: ${check.fast_path ? "yes" : "no"}`,
      `- Runtime modes: ${Object.entries(check.runtime_modes || {}).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
      `- Canvas: ${check.canvas == null ? "null" : "present"}`,
      `- In-db agent: ${check.in_db_agent == null ? "null" : "present"}`,
      `- Trace persisted: ${check.trace_persisted ? "yes" : "no"}`,
      `- Promotion verdict: ${check.promotion_verdict || "unknown"}`,
    ];
  }
  if (check.name === "model-proof-bundle") {
    return [
      `- Strict expected blocker: ${check.strict_expected_blocker ? "yes" : "no"}`,
      check.skipped ? "- Skipped by flag" : "- Proof bundle refreshed",
    ];
  }
  return [];
}

function renderMarkdown(report) {
  const lines = [
    "# Save the Wildlife Conference Demo Preflight",
    "",
    `- Generated: ${report.generated_at}`,
    `- Base URL: ${report.base_url}`,
    `- Session: ${report.session_id}`,
    `- Player: ${report.player_id}`,
    `- Verdict: ${report.verdict}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`### ${statusIcon(check.status)} ${check.name}`);
    lines.push("");
    for (const line of renderDetails(check)) lines.push(line);
    if (check.failures?.length) {
      lines.push("- Failures:");
      for (const failure of check.failures) lines.push(`  - ${failure}`);
    }
    if (check.warnings?.length) {
      lines.push("- Warnings:");
      for (const warning of check.warnings) lines.push(`  - ${warning}`);
    }
    if (check.error) lines.push(`- Error: ${check.error.split("\n")[0]}`);
    lines.push("");
  }
  lines.push("## Presenter Boundary");
  lines.push("");
  lines.push("- Safe to claim: live game, PAF health, Oracle AI Database evidence path, Select AI/in-db agent fast path, graph/replay/vector retrieval configuration, and grounded commentary constraints.");
  lines.push("- Claim trace persistence, GenAI, candidate shadow evaluation, or fine-tuned-model improvement only when the corresponding response metadata is green.");
  lines.push("- For this smoke response, claim only the model routes present in response metadata; Select AI may return first when stage-safe latency is the priority.");
  lines.push("- For this smoke response, do not say Canvas produced the exact line unless `canvas` becomes non-null or the response source changes accordingly.");
  lines.push("");
  return `${lines.join("\n")}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", process.env.STWL_DEMO_BASE_URL || DEFAULT_BASE_URL));
  const sessionId = argValue("session-id", process.env.STWL_DEMO_SESSION_ID || DEFAULT_SESSION_ID);
  const playerId = argValue("player-id", process.env.STWL_DEMO_PLAYER_ID || DEFAULT_PLAYER_ID);
  const outputDir = argValue("output-dir", process.env.STWL_CONFERENCE_PREFLIGHT_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", process.env.STWL_DEMO_TIMEOUT_MS || "20000"));
  const payload = { session_id: sessionId, player_id: playerId, max_chars: 200 };

  const checks = [];
  checks.push(await checkGame(baseUrl, timeoutMs));
  checks.push(await checkHealth(baseUrl, timeoutMs));
  checks.push(await checkContext(baseUrl, payload, timeoutMs));
  checks.push(await checkCommentary(baseUrl, payload, timeoutMs));
  checks.push(runProofBundle(hasFlag("skip-proof")));

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    session_id: sessionId,
    player_id: playerId,
    verdict: finalVerdict(checks),
    checks,
  };

  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "latest.json");
  const mdPath = path.join(outputDir, "latest.md");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(mdPath, renderMarkdown(report), "utf8");

  for (const check of checks) {
    console.log(`${statusIcon(check.status)} ${check.name}`);
  }
  console.log(`verdict=${report.verdict}`);
  console.log(`json=${jsonPath}`);
  console.log(`summary=${mdPath}`);

  if (report.verdict === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
