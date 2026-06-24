#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_ROOM_ID = "ROOM-0001";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "paf-canvas-mcp-proof");

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

function compactError(error) {
  return error?.stack || error?.message || String(error || "");
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

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return JSON.parse(text);
}

async function mcp(baseUrl, method, params = {}, id = 1, timeoutMs = 15000) {
  return fetchJson(`${baseUrl}/paf/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }, timeoutMs);
}

function check(name, status, details = {}) {
  return { name, status, ...details };
}

function statusFromFailures(failures = [], warnings = []) {
  if (failures.length) return "fail";
  if (warnings.length) return "warn";
  return "pass";
}

async function checkHealth(baseUrl, timeoutMs) {
  try {
    const health = await fetchJson(`${baseUrl}/paf/healthz`, {}, timeoutMs);
    const failures = [];
    const warnings = [];
    if (health.ok !== true) failures.push("ok!=true");
    if (health.oracle_configured !== true) failures.push("oracle_configured!=true");
    if (health.indb_agent_enabled !== true) failures.push("indb_agent_enabled!=true");
    if (health.select_ai_auto_init !== true) failures.push("select_ai_auto_init!=true");
    if (health.mcp_enabled !== true) failures.push("mcp_enabled!=true");
    const tools = new Set(health.mcp_tools || []);
    for (const tool of ["get_live_match_context", "get_session_summary", "create_commentary_line"]) {
      if (!tools.has(tool)) failures.push(`missing health mcp tool ${tool}`);
    }
    if (!health.mcp_public_url) warnings.push("mcp_public_url is empty; Canvas registration may need an explicit URL");
    if (health.canvas_configured !== true) warnings.push("canvas_configured!=true");
    return check("paf-health-mcp", statusFromFailures(failures, warnings), {
      failures,
      warnings,
      version: health.version,
      canvas_configured: health.canvas_configured === true,
      canvas_endpoint: health.canvas_endpoint || "",
      mcp_public_url: health.mcp_public_url || "",
      mcp_tools: health.mcp_tools || [],
      select_ai_profile: health.select_ai_profile || "",
      select_ai_model: health.select_ai_model || "",
    });
  } catch (error) {
    return check("paf-health-mcp", "fail", { error: compactError(error) });
  }
}

async function checkMcpHandshake(baseUrl, timeoutMs) {
  try {
    const init = await mcp(baseUrl, "initialize", {}, 1, timeoutMs);
    const listed = await mcp(baseUrl, "tools/list", {}, 2, timeoutMs);
    const failures = [];
    if (init.result?.serverInfo?.name !== "save-the-wildlife-match-intelligence") {
      failures.push(`serverInfo.name=${init.result?.serverInfo?.name || "missing"}`);
    }
    const toolNames = (listed.result?.tools || []).map((tool) => tool.name);
    for (const tool of ["get_live_match_context", "get_session_summary", "create_commentary_line"]) {
      if (!toolNames.includes(tool)) failures.push(`missing listed tool ${tool}`);
    }
    if (toolNames.includes("query_sql")) failures.push("unsafe query_sql tool is exposed");
    return check("mcp-handshake", failures.length ? "fail" : "pass", {
      failures,
      serverInfo: init.result?.serverInfo || null,
      tools: toolNames,
    });
  } catch (error) {
    return check("mcp-handshake", "fail", { error: compactError(error) });
  }
}

async function checkMcpContext(baseUrl, roomId, timeoutMs) {
  try {
    const response = await mcp(baseUrl, "tools/call", {
      name: "get_live_match_context",
      arguments: {
        room_id: roomId,
        output_format: "live_line",
        max_chars: 200,
      },
    }, 3, timeoutMs);
    const context = response.result?.structuredContent || {};
    const summary = context.summary || {};
    const failures = [];
    const warnings = [];
    if (response.result?.isError === true) failures.push("isError=true");
    if (context.ok !== true) failures.push("context.ok!=true");
    if (!summary.session_id) failures.push("missing summary.session_id");
    if (!summary.player_id) failures.push("missing summary.player_id");
    if (!Number.isFinite(Number(summary.score))) failures.push("summary.score is not numeric");
    if (!Array.isArray(context.json_events)) failures.push("json_events is not an array");
    if (!Array.isArray(context.graph_facts)) failures.push("graph_facts is not an array");
    if (context.source !== "oracle-match-intelligence" && context.source !== "oracle-room-latest") {
      warnings.push(`context.source=${context.source || "missing"}`);
    }
    return check("mcp-live-context", statusFromFailures(failures, warnings), {
      failures,
      warnings,
      source: context.source,
      summary: {
        session_id: summary.session_id,
        room_id: summary.room_id,
        player_id: summary.player_id,
        player_name: summary.player_name,
        score: summary.score,
        powerups: summary.powerups || {},
        trail_crosses: summary.trail_crosses,
        freezes: summary.freezes,
      },
      json_event_count: (context.json_events || []).length,
      graph_fact_count: (context.graph_facts || []).length,
      replay_clip_count: (context.replay_clips || []).length,
      vector_memory_count: (context.vector_memories || []).length,
      formats: context.formats || {},
    });
  } catch (error) {
    return check("mcp-live-context", "fail", { error: compactError(error) });
  }
}

async function checkMcpCommentary(baseUrl, roomId, timeoutMs) {
  try {
    const response = await mcp(baseUrl, "tools/call", {
      name: "create_commentary_line",
      arguments: {
        room_id: roomId,
        output_format: "live_line",
        max_chars: 200,
      },
    }, 4, timeoutMs);
    const content = response.result?.structuredContent || {};
    const commentary = String(content.commentary || "");
    const failures = [];
    const warnings = [];
    if (response.result?.isError === true) failures.push("isError=true");
    if (content.ok !== true) failures.push("commentary.ok!=true");
    if (!commentary.trim()) failures.push("missing commentary");
    if (commentary.length > 200) failures.push(`commentary too long: ${commentary.length}`);
    if (content.source === "deterministic-fallback") warnings.push("source=deterministic-fallback; Canvas/PAF model path did not produce this line");
    return check("mcp-commentary", statusFromFailures(failures, warnings), {
      failures,
      warnings,
      commentary,
      commentary_length: commentary.length,
      source: content.source || "",
      fallback_source: content.fallback_source || "",
      trace_id: content.trace_id || "",
    });
  } catch (error) {
    return check("mcp-commentary", "fail", { error: compactError(error) });
  }
}

function verdict(checks) {
  if (checks.some((item) => item.status === "fail")) return "failed";
  if (checks.some((item) => item.status === "warn")) return "ready_with_caveats";
  return "ready";
}

function renderMarkdown(report) {
  const lines = [
    "# PAF Canvas MCP Proof",
    "",
    `- verdict: ${report.verdict}`,
    `- base_url: ${report.base_url}`,
    `- room_id: ${report.room_id}`,
    `- checked_at: ${report.checked_at}`,
    "",
    "## Checks",
    "",
  ];
  for (const item of report.checks) {
    lines.push(`### ${item.name}`);
    lines.push("");
    lines.push(`- status: ${item.status}`);
    if (item.failures?.length) lines.push(`- failures: ${item.failures.join("; ")}`);
    if (item.warnings?.length) lines.push(`- warnings: ${item.warnings.join("; ")}`);
    if (item.error) lines.push(`- error: ${item.error.split("\n")[0]}`);
    if (item.tools?.length) lines.push(`- tools: ${item.tools.join(", ")}`);
    if (item.mcp_tools?.length) lines.push(`- health_tools: ${item.mcp_tools.join(", ")}`);
    if (item.mcp_public_url) lines.push(`- mcp_public_url: ${item.mcp_public_url}`);
    if (item.canvas_endpoint) lines.push(`- canvas_endpoint: ${item.canvas_endpoint}`);
    if (item.source) lines.push(`- source: ${item.source}`);
    if (item.commentary) lines.push(`- commentary: ${item.commentary}`);
    if (item.summary) lines.push(`- summary: ${JSON.stringify(item.summary)}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", process.env.STWL_BASE_URL || DEFAULT_BASE_URL));
  const roomId = argValue("room-id", process.env.STWL_ROOM_ID || DEFAULT_ROOM_ID);
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "15000"));
  const checks = [
    await checkHealth(baseUrl, timeoutMs),
    await checkMcpHandshake(baseUrl, timeoutMs),
    await checkMcpContext(baseUrl, roomId, timeoutMs),
    await checkMcpCommentary(baseUrl, roomId, timeoutMs),
  ];
  const report = {
    verdict: verdict(checks),
    base_url: baseUrl,
    room_id: roomId,
    checked_at: new Date().toISOString(),
    checks,
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, "latest.md"), renderMarkdown(report));
  console.log(renderMarkdown(report));
  if (report.verdict === "failed") process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
