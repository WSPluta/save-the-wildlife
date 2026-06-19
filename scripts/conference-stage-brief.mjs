#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "conference-stage-brief");

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

function compactOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.error) throw result.error;
  const output = compactOutput(result);
  if (result.status !== 0) {
    throw new Error(output || `${scriptPath} exited ${result.status}`);
  }
  return output;
}

function runRefreshStep(scriptPath, args = []) {
  try {
    return {
      command: `node ${scriptPath}`,
      status: "pass",
      output: runNodeScript(scriptPath, args),
    };
  } catch (error) {
    return {
      command: `node ${scriptPath}`,
      status: "fail",
      output: error.stack || error.message || String(error),
    };
  }
}

function runGit(args = []) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 256,
  });
  if (result.status !== 0) return "unknown";
  return compactOutput(result);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, filePath), "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function checkNamed(report, name) {
  return report?.checks?.find((check) => check.name === name) || {};
}

function statusLabel(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function yesNo(value) {
  return value === true ? "yes" : "no";
}

function numberText(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits).replace(/\.?0+$/, "") : "unknown";
}

function runtimeModesText(modes = {}) {
  const entries = Object.entries(modes);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "unknown";
}

function strictFailureIsExpected(report) {
  if (report?.verdict !== "failed") return false;
  const failed = (report.checks || []).filter((check) => check.status === "fail");
  if (failed.length !== 1 || failed[0].name !== "private-adapter-health") return false;
  const failures = failed[0].failures || [];
  return failures.length > 0 && failures.every((failure) => failure.includes("runtime_mode=behavior-adapter"));
}

function computeStageVerdict({ preflight, game, transport, adapter, strict, localProofBrowserBlocked }) {
  const preflightOk = ["ready", "ready_with_caveats"].includes(preflight?.verdict);
  const gameOk = game?.verdict === "ready";
  const transportOk = !transport || ["ready", "ready_with_caveats"].includes(transport?.verdict);
  const adapterOk = ["ready", "ready_with_upstream_llm_blocker"].includes(adapter?.verdict);
  const strictOk = strict?.verdict === "ready" || strictFailureIsExpected(strict);
  if (!preflightOk || !gameOk || !transportOk || !adapterOk || !strictOk) return "no_go";
  if (localProofBrowserBlocked) return "go_with_local_proof_blocker";
  if (preflight.verdict === "ready" && adapter.verdict === "ready" && strict.verdict === "ready") return "go";
  return "go_with_caveats";
}

function refreshErrorText(refreshOutputs = []) {
  const failures = refreshOutputs.filter((step) => step.status === "fail");
  return failures.map((step) => `${step.command}: ${step.output.split("\n")[0]}`);
}

function firstLine(text) {
  return String(text || "").split("\n").find(Boolean) || "unknown failure";
}

function receiptFailureText(game = {}) {
  return (game.checks || [])
    .filter((check) => check.status === "fail")
    .map((check) => {
      const error = String(check.error || "");
      if (error.includes("bootstrap_check_in") || error.includes("MachPortRendezvous")) {
        return `${check.name}: local Playwright/Chromium launch blocked by macOS sandbox permission before the page opened`;
      }
      return `${check.name}: ${firstLine(error || check.failures?.join("; "))}`;
    });
}

function isReceiptBrowserBlocked(game) {
  const checks = Array.isArray(game?.checks) ? game.checks : [];
  const failed = checks.filter((check) => check.status === "fail");
  return failed.length > 0 && failed.every((check) => {
    const error = String(check.error || "");
    return error.includes("browserType.launch")
      && (
        error.includes("bootstrap_check_in")
        || error.includes("MachPortRendezvous")
        || error.includes("Permission denied")
      );
  });
}

function renderWarnings(check = {}) {
  const warnings = check.warnings || [];
  return warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- none"];
}

function transportSummary(transport = {}) {
  const socket = checkNamed(transport, "socket-room-lifecycle");
  const http = checkNamed(transport, "http-game-url");
  return {
    verdict: transport.verdict || "missing",
    httpStatus: http.statusCode || "unknown",
    socketStatus: socket.status || "missing",
    room: socket.room || "unknown",
    connected: socket.connected === true,
    itemCounts: socket.itemCounts || null,
    gameTime: socket.gameTime,
  };
}

function stageClaimLines(brief) {
  if (brief.stage_verdict === "no_go") {
    return [
      "- The game is the wrapper. The pattern is live match intelligence.",
      "- The current AI receipts prove PAF wiring, Oracle AI Database evidence, adapter-mode model proof, training capture, and the strict claim boundary.",
      "- The playable/mobile game claim needs a fresh successful game smoke or direct manual verification from a normal browser before stage.",
      "- SQL decides the facts. JSON carries flexible event and replay payloads. Graph explains causality. Vector memory is available when similar moments exist.",
      "- This is what production AI systems need: not one giant prompt, but a live system with memory, tools, traces, policy, and a model inside a harness.",
    ];
  }
  if (brief.stage_verdict === "go_with_local_proof_blocker") {
    return [
      "- The game is the wrapper. The pattern is live match intelligence.",
      "- The preserved game receipt proves the playable/mobile path; this shell could not refresh it because the local proof browser was blocked before page load.",
      "- The AI receipts prove PAF wiring, Oracle AI Database evidence, adapter-mode model proof, training capture, and the strict claim boundary.",
      "- SQL decides the facts. JSON carries flexible event and replay payloads. Graph explains causality. Vector memory is available when similar moments exist.",
      "- This is what production AI systems need: not one giant prompt, but a live system with memory, tools, traces, policy, and a model inside a harness.",
    ];
  }
  return [
    "- The game is the wrapper. The pattern is live match intelligence.",
    "- SQL decides the facts. JSON carries flexible event and replay payloads. Graph explains causality. Vector memory is available when similar moments exist.",
    "- PAF and Canvas are the agent workflow surface. The harness owns evidence, routing, policy, fallback, traces, and training capture.",
    "- The current receipts prove the app, mobile playability, PAF wiring, Oracle AI Database evidence path, adapter-mode model proof, and the strict claim boundary.",
    "- This is what production AI systems need: not one giant prompt, but a live system with memory, tools, traces, policy, and a model inside a harness.",
  ];
}

function renderBriefMarkdown({ brief, preflight, game, gameLatest, transport, adapter, strict }) {
  const gameUrl = checkNamed(preflight, "game-url");
  const paf = checkNamed(preflight, "paf-health");
  const context = checkNamed(preflight, "match-context");
  const commentary = checkNamed(preflight, "commentary");
  const transportInfo = transportSummary(transport);
  const mobile = checkNamed(game, "mobile-gameplay");
  const desktop = checkNamed(game, "desktop-gameplay");
  const adapterCanary = checkNamed(adapter, "local-canary-reports").reportSummaries?.find(
    (summary) => summary.runId === "202606132052-fastpath-full"
  ) || {};
  const strictCanary = checkNamed(adapter, "local-canary-reports").reportSummaries?.find(
    (summary) => summary.upstreamRuntimeRequired
  ) || {};
  const training = checkNamed(adapter, "training-export-sample");
  const deployments = checkNamed(adapter, "kubernetes-deployments").deployments || [];
  const router = paf.router || {};
  const mobileState = mobile.state || {};
  const desktopState = desktop.state || {};

  const lines = [
    "# Save the Wildlife Live Stage Brief",
    "",
    `- Generated: ${brief.generated_at}`,
    `- Stage verdict: ${brief.stage_verdict}`,
    `- Base URL: ${brief.base_url}`,
    `- Verified commit: ${brief.git_commit}`,
    `- PAF Canvas: https://145.241.196.162:8080/agentFactory/`,
    "",
    "## One-Line Posture",
    "",
    brief.stage_verdict === "no_go"
      ? "> Do not present this as ready yet. One or more proof receipts failed."
      : brief.stage_verdict === "go_with_local_proof_blocker"
        ? "> The app evidence is green, but this local shell could not launch the proof browser. Use the preserved last-ready game receipt and rerun from a normal terminal before stage."
      : "> The game path is green. The AI path is green with honest caveats. Proof first, claim second.",
    "",
    ...(brief.refresh_errors.length || brief.receipt_errors.length
      ? [
          "## Refresh Blockers",
          "",
          ...[...brief.refresh_errors, ...brief.receipt_errors].map((error) => `- ${error}`),
          "",
        ]
      : []),
    brief.stage_verdict === "no_go" ? "## Current Receipts" : "## Green Receipts",
    "",
    `- Game evidence source: ${brief.game_evidence_source}.`,
    `- Game smoke: ${statusLabel(game.verdict)}; public endpoint HEAD status ${gameUrl.statusCode || "unknown"}; ETag ${gameUrl.etag || "unknown"}.`,
    ...(gameLatest && gameLatest !== game
      ? [`- Latest game refresh: ${statusLabel(gameLatest.verdict)}; preserved evidence is from \`${brief.receipts.game_smoke_ready}\`.`]
      : []),
    `- Mobile: ${mobile.status || "unknown"}; mode ${mobileState.mode || "unknown"}; joystick ${mobile.joystick ? `${numberText(mobile.joystick.width, 0)}x${numberText(mobile.joystick.height, 0)}` : "unknown"}; boat y ${numberText(mobileState.boatFeel?.y)}; seat depth ${numberText(mobileState.waterlineContact?.seatDepth)}.`,
    `- Desktop: ${desktop.status || "unknown"}; mode ${desktopState.mode || "unknown"}; wake ripples ${desktopState.wakeRipples?.visible ?? "unknown"}; boat y ${numberText(desktopState.boatFeel?.y)}; seat depth ${numberText(desktopState.waterlineContact?.seatDepth)}.`,
    `- Transport smoke: ${statusLabel(transportInfo.verdict)}; HTTP ${transportInfo.httpStatus}; socket ${transportInfo.socketStatus}; room ${transportInfo.room}; items ${transportInfo.itemCounts ? JSON.stringify(transportInfo.itemCounts) : "unknown"}.`,
    `- PAF health: ${paf.status || "unknown"}; version ${paf.version || "unknown"}; Select AI ${paf.select_ai_profile || "unknown"} / ${paf.select_ai_model || "unknown"}.`,
    `- PAF wiring: Canvas ${yesNo(paf.canvas_configured)}; in-db agent ${yesNo(paf.indb_agent_enabled)}; router ${router.route_mode || "unknown"} ${router.primary_provider || "unknown"} -> ${router.candidate_provider || "unknown"}.`,
    `- Model proof: adapter ${adapter.verdict || "unknown"}; strict upstream ${strict.verdict || "unknown"}; strict blocker expected ${yesNo(strictFailureIsExpected(strict))}.`,
    `- Scale proof: ${adapterCanary.joined || 0}/${adapterCanary.attempted || 0} joins; ${adapterCanary.scoreRows || 0} score rows; ${adapterCanary.commentary || 0} commentary; ${adapterCanary.duplicates || 0} duplicates; p95 ${adapterCanary.p95Ms ?? "unknown"} ms.`,
    `- Training capture: ${training.example_count ?? "unknown"} examples; sample provider ${training.provider || "unknown"}; prompt redacted ${yesNo(training.prompt_text_redacted)}.`,
    "",
    "## Match Intelligence Evidence",
    "",
    `- Source: ${context.evidence?.source || "unknown"}.`,
    `- Player: ${context.evidence?.player_name || "unknown"}; score ${context.evidence?.score ?? "unknown"}.`,
    `- Mechanics: shield ${context.evidence?.powerup_shield ?? 0}; trail crossings ${context.evidence?.trail_crosses ?? 0}; freezes ${context.evidence?.freezes ?? 0}.`,
    `- Coordinates: last position ${JSON.stringify(context.evidence?.last_position || null)}.`,
    `- JSON events: ${(context.evidence?.json_event_types || []).join(", ") || "none"}.`,
    `- Graph facts: ${(context.evidence?.graph_facts || []).join(", ") || "none"}.`,
    `- Replay clips in this smoke session: ${context.evidence?.replay_clip_count ?? 0}.`,
    `- Vector memories in this smoke session: ${context.evidence?.vector_memory_count ?? 0}.`,
    "",
    "## Commentary Evidence",
    "",
    `- Line: "${commentary.commentary || "missing"}"`,
    `- Length: ${commentary.commentary_length ?? "unknown"} characters.`,
    `- Source: ${commentary.source || "unknown"}; fallback ${commentary.fallback_source || "unknown"}.`,
    `- Runtime modes: ${runtimeModesText(commentary.runtime_modes)}.`,
    `- Canvas metadata for this line: ${commentary.canvas == null ? "null" : JSON.stringify(commentary.canvas)}.`,
    `- In-db agent metadata for this line: ${commentary.in_db_agent == null ? "null" : JSON.stringify(commentary.in_db_agent)}.`,
    `- Trace persisted: ${yesNo(commentary.trace_persisted)}; promotion verdict ${commentary.promotion_verdict || "unknown"}.`,
    "",
    "## Say This",
    "",
    ...stageClaimLines(brief),
    "",
    "## Keep Gated",
    "",
    "- Do not claim two live private upstream LLM runtimes until strict upstream passes.",
    "- Do not claim this exact smoke commentary line came from Canvas while `canvas` is null.",
    "- Do not claim this exact smoke commentary line used an in-db agent while `in_db_agent` is null.",
    "- Do not claim replay-caption or vector-memory evidence for this smoke session while the counts are zero.",
    "- Do not say the model watched raw gameplay footage. It receives bounded evidence and clip pointers.",
    "",
    "## Current Warnings",
    "",
    "### Match Context",
    "",
    ...renderWarnings(context),
    "",
    "### Commentary",
    "",
    ...renderWarnings(commentary),
    "",
    "## Kubernetes Snapshot",
    "",
    "| Deployment | Ready | Available |",
    "| --- | ---: | ---: |",
    ...(deployments.length
      ? deployments.map((deployment) => `| ${deployment.name} | ${deployment.ready}/${deployment.replicas} | ${deployment.available}/${deployment.replicas} |`)
      : ["| unknown | 0/0 | 0/0 |"]),
    "",
    "## Receipts",
    "",
    "- `.codex_tmp/conference-stage-brief/latest.md`",
    "- `.codex_tmp/conference-preflight/latest.md`",
    "- `.codex_tmp/conference-game-smoke/latest.md`",
    "- `.codex_tmp/conference-transport-smoke/latest.md`",
    "- `.codex_tmp/model-ai-readiness/proof-bundle.md`",
    "- `.codex_tmp/conference-game-smoke/mobile/running.png`",
    "- `.codex_tmp/conference-game-smoke/desktop/running.png`",
    "",
    "## Commands",
    "",
    "```bash",
    "npm run check:conference-demo:stage",
    "npm run check:conference-demo -- --skip-proof",
    "npm run check:conference-demo:transport",
    "npm run check:conference-demo:game",
    "npm run check:model-ai-demo:proof",
    "```",
    "",
  ];

  return `${lines.join("\n")}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", process.env.STWL_DEMO_BASE_URL || DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", process.env.STWL_STAGE_BRIEF_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const refresh = !hasFlag("skip-refresh");
  const refreshOutputs = [];

  if (refresh) {
    const baseArgs = ["--base-url", baseUrl];
    refreshOutputs.push(runRefreshStep(path.join("scripts", "conference-demo-preflight.mjs"), baseArgs));
    refreshOutputs.push(runRefreshStep(path.join("scripts", "conference-transport-smoke.mjs"), baseArgs));
    refreshOutputs.push(runRefreshStep(path.join("scripts", "conference-game-smoke.mjs"), baseArgs));
  }

  const [preflight, transport, game, adapter, strict] = await Promise.all([
    readJson(path.join(".codex_tmp", "conference-preflight", "latest.json")),
    readJsonIfExists(path.join(".codex_tmp", "conference-transport-smoke", "latest.json")),
    readJson(path.join(".codex_tmp", "conference-game-smoke", "latest.json")),
    readJson(path.join(".codex_tmp", "model-ai-readiness", "adapter-mode.json")),
    readJson(path.join(".codex_tmp", "model-ai-readiness", "strict-upstream.json")),
  ]);
  const lastReadyGame = await readJsonIfExists(path.join(".codex_tmp", "conference-game-smoke", "last-ready.json"));
  const browserBlockedGame = await readJsonIfExists(path.join(".codex_tmp", "conference-game-smoke", "last-browser-blocked.json"));

  const refreshErrors = refreshErrorText(refreshOutputs);
  const localProofBrowserBlocked = isReceiptBrowserBlocked(game) || isReceiptBrowserBlocked(browserBlockedGame);
  const browserBlockedEvidence = isReceiptBrowserBlocked(game) ? game : browserBlockedGame;
  const receiptErrors = receiptFailureText(browserBlockedEvidence || game);
  const gameEvidence = localProofBrowserBlocked && game?.verdict === "ready"
    ? game
    : localProofBrowserBlocked && lastReadyGame?.verdict === "ready"
      ? lastReadyGame
      : game;
  const computedVerdict = computeStageVerdict({
    preflight,
    game: gameEvidence,
    transport,
    adapter,
    strict,
    localProofBrowserBlocked,
  });
  const hardRefreshErrors = refreshOutputs
    .filter((step) => step.status === "fail")
    .filter((step) => {
      const isGameSmoke = step.command.includes("conference-game-smoke.mjs");
      return !(isGameSmoke && localProofBrowserBlocked && lastReadyGame?.verdict === "ready");
    })
    .map((step) => `${step.command}: ${step.output.split("\n")[0]}`);
  const brief = {
    generated_at: new Date().toISOString(),
    stage_verdict: hardRefreshErrors.length ? "no_go" : computedVerdict,
    base_url: baseUrl,
    git_commit: runGit(["rev-parse", "--short", "HEAD"]),
    refreshed: refresh,
    refresh_outputs: refreshOutputs,
    refresh_errors: refreshErrors,
    receipt_errors: receiptErrors,
    local_proof_browser_blocked: localProofBrowserBlocked,
    game_evidence_source: gameEvidence === lastReadyGame ? "last-ready" : "latest",
    receipts: {
      preflight: path.join(".codex_tmp", "conference-preflight", "latest.md"),
      transport_smoke: path.join(".codex_tmp", "conference-transport-smoke", "latest.md"),
      game_smoke: path.join(".codex_tmp", "conference-game-smoke", "latest.md"),
      game_smoke_ready: path.join(".codex_tmp", "conference-game-smoke", "last-ready.md"),
      proof_bundle: path.join(".codex_tmp", "model-ai-readiness", "proof-bundle.md"),
    },
  };

  await fs.mkdir(path.join(REPO_ROOT, outputDir), { recursive: true });
  const markdown = renderBriefMarkdown({ brief, preflight, game: gameEvidence, gameLatest: game, transport, adapter, strict });
  const mdPath = path.join(outputDir, "latest.md");
  const jsonPath = path.join(outputDir, "latest.json");
  await fs.writeFile(path.join(REPO_ROOT, mdPath), markdown, "utf8");
  await fs.writeFile(path.join(REPO_ROOT, jsonPath), `${JSON.stringify(brief, null, 2)}\n`, "utf8");

  console.log(`stage_verdict=${brief.stage_verdict}`);
  console.log(`stage_brief=${mdPath}`);
  console.log(`stage_brief_json=${jsonPath}`);

  if (brief.stage_verdict === "no_go") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
