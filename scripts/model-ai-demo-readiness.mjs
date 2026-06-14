#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "model-ai-readiness");
const REQUIRED_ADMIN_TEXT = [
  "202606132052-fastpath-full",
  "25 live examples",
  "Trainer dry-run",
  "202606140238-upstream-gate-refresh",
  "upstream formats openai:2",
  "OpenAI upstream handoff contract",
  "blocked only on behavior-adapter runtime",
];
const REQUIRED_REPORTS = [
  "output/prod-load/202606132052-fastpath-full/summary.md",
  "output/prod-load/202606140238-upstream-gate-refresh/summary.md",
];
const REQUIRED_DEPLOYS = [
  "stwl-base-commentary",
  "stwl-ft-commentary",
  "private-agent-factory",
  "ws-server",
  "web",
  "score",
  "replay",
];
const REQUIRED_ADAPTER_PROVIDERS = ["oci-base", "oci-fine-tuned"];
const SUPPORTED_UPSTREAM_FORMATS = new Set(["openai", "internal"]);

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

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function compactError(error) {
  if (!error) return "";
  return error.stack || error.message || String(error);
}

function makeCheck(name, status, details = {}) {
  return { name, status, ...details };
}

function repoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs) {
  return JSON.parse(await fetchText(url, timeoutMs));
}

async function pathExists(filePath) {
  try {
    await fs.access(repoPath(filePath));
    return true;
  } catch {
    return false;
  }
}

async function checkPafHealth(config) {
  try {
    const health = await fetchJson(`${config.baseUrl}/paf/healthz`, config.timeoutMs);
    const router = health.model_router || {};
    const failures = [];
    if (!health.ok) failures.push("PAF health did not report ok=true");
    if (router.route_mode !== "shadow") failures.push(`route_mode=${router.route_mode}`);
    if (router.primary_provider !== "oci-base") failures.push(`primary_provider=${router.primary_provider}`);
    if (router.candidate_provider !== "oci-fine-tuned") failures.push(`candidate_provider=${router.candidate_provider}`);
    if (!router.base_endpoint_configured) failures.push("base endpoint not configured");
    if (!router.fine_tuned_endpoint_configured) failures.push("fine-tuned endpoint not configured");
    if (!router.trace_persist) failures.push("trace persistence disabled");
    if (!router.eval_enabled) failures.push("eval disabled");
    if (!router.training_capture_enabled) failures.push("training capture disabled");
    return makeCheck("paf-health", failures.length ? "fail" : "pass", { router, failures });
  } catch (error) {
    return makeCheck("paf-health", "fail", { error: compactError(error) });
  }
}

async function checkAdminProof(config) {
  try {
    const html = await fetchText(`${config.baseUrl}/admin/ai-learning`, config.timeoutMs);
    const missing = REQUIRED_ADMIN_TEXT.filter((text) => !html.includes(text));
    return makeCheck("admin-proof-ui", missing.length ? "fail" : "pass", {
      requiredText: REQUIRED_ADMIN_TEXT,
      missing,
    });
  } catch (error) {
    return makeCheck("admin-proof-ui", "fail", { error: compactError(error) });
  }
}

async function checkLocalReports() {
  const missing = [];
  for (const reportPath of REQUIRED_REPORTS) {
    if (!(await pathExists(reportPath))) missing.push(reportPath);
  }
  return makeCheck("local-canary-reports", missing.length ? "warn" : "pass", {
    reports: REQUIRED_REPORTS,
    missing,
  });
}

async function checkTrainingExport() {
  const exportPath = ".codex_tmp/stwl-behavior-v1-live.jsonl";
  try {
    const raw = await fs.readFile(repoPath(exportPath), "utf8");
    const first = raw.trim().split("\n").filter(Boolean)[0];
    const sample = JSON.parse(first);
    const failures = [];
    if (sample.prompt_text_redacted !== true) failures.push("prompt_text_redacted is not true");
    if (!sample.prompt_hash) failures.push("missing prompt_hash");
    if (!sample.evidence_hash) failures.push("missing evidence_hash");
    if (!Array.isArray(sample.citations) || sample.citations.length === 0) failures.push("missing citations");
    if (!String(sample.provider || "").includes("oci-fine-tuned")) failures.push(`unexpected provider=${sample.provider}`);
    return makeCheck("training-export-sample", failures.length ? "fail" : "pass", {
      file: exportPath,
      trace_id: sample.trace_id,
      provider: sample.provider,
      model_id: sample.model_id,
      prompt_text_redacted: sample.prompt_text_redacted,
      citation_count: sample.citations?.length || 0,
      failures,
    });
  } catch (error) {
    return makeCheck("training-export-sample", "warn", {
      file: exportPath,
      error: compactError(error),
    });
  }
}

function runKubectl(args, config) {
  const result = spawnSync("kubectl", ["--kubeconfig", config.kubeconfig, "-n", config.namespace, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `kubectl exited ${result.status}`).trim());
  }
  return result.stdout.trim();
}

async function checkKubernetes(config) {
  if (config.skipKube) {
    return makeCheck("kubernetes-deployments", "warn", { skipped: true });
  }
  if (!(await pathExists(config.kubeconfig))) {
    return makeCheck("kubernetes-deployments", "warn", {
      skipped: true,
      reason: `missing ${config.kubeconfig}`,
    });
  }
  try {
    const json = runKubectl([
      "get",
      "deploy",
      ...REQUIRED_DEPLOYS,
      "-o",
      "json",
    ], config);
    const data = JSON.parse(json);
    const deployments = data.items.map((item) => ({
      name: item.metadata.name,
      ready: item.status.readyReplicas || 0,
      replicas: item.status.replicas || 0,
      available: item.status.availableReplicas || 0,
    }));
    const failures = deployments
      .filter((item) => item.ready < item.replicas || item.available < item.replicas)
      .map((item) => `${item.name} ${item.ready}/${item.replicas}`);
    return makeCheck("kubernetes-deployments", failures.length ? "fail" : "pass", {
      deployments,
      failures,
    });
  } catch (error) {
    return makeCheck("kubernetes-deployments", "warn", { error: compactError(error) });
  }
}

async function checkPrivateAdapterHealth(config) {
  if (config.skipKube) {
    return makeCheck("private-adapter-health", "warn", { skipped: true });
  }
  if (!(await pathExists(config.kubeconfig))) {
    return makeCheck("private-adapter-health", "warn", {
      skipped: true,
      reason: `missing ${config.kubeconfig}`,
    });
  }
  const probe = `
const urls = ["http://stwl-base-commentary:8080/healthz","http://stwl-ft-commentary:8080/healthz"];
for (const url of urls) {
  const response = await fetch(url);
  console.log(JSON.stringify({ url, body: await response.json() }));
}
`;
  try {
    const output = runKubectl([
      "exec",
      "deploy/private-agent-factory",
      "--",
      "node",
      "-e",
      probe,
    ], config);
    const adapters = output
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line));
    const failures = [];
    const providerCounts = {};
    const runtimeCounts = {};
    const upstreamFormatCounts = {};
    for (const adapter of adapters) {
      const body = adapter.body || {};
      const provider = body.provider || "unknown";
      const upstreamFormat = body.upstream_format || "missing";
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
      const key = `${body.provider || "unknown"}:${body.runtime_mode || "missing"}`;
      runtimeCounts[key] = (runtimeCounts[key] || 0) + 1;
      upstreamFormatCounts[upstreamFormat] = (upstreamFormatCounts[upstreamFormat] || 0) + 1;
      if (!body.ok) failures.push(`${adapter.url} not ok`);
      if (!body.provider) failures.push(`${adapter.url} missing provider`);
      if (!body.runtime_mode) failures.push(`${adapter.url} missing runtime_mode`);
      if (!body.upstream_format) failures.push(`${provider} missing upstream_format`);
      if (body.upstream_format && !SUPPORTED_UPSTREAM_FORMATS.has(body.upstream_format)) {
        failures.push(`${provider} unsupported upstream_format=${body.upstream_format}`);
      }
      if (config.requireUpstreamLlm && body.runtime_mode !== "upstream-llm") {
        failures.push(`${body.provider || adapter.url} runtime_mode=${body.runtime_mode}`);
      }
    }
    for (const provider of REQUIRED_ADAPTER_PROVIDERS) {
      if (!providerCounts[provider]) failures.push(`missing adapter provider ${provider}`);
    }
    const status = failures.length ? "fail" : "pass";
    return makeCheck("private-adapter-health", status, {
      adapters,
      providerCounts,
      runtimeCounts,
      upstreamFormatCounts,
      failures,
    });
  } catch (error) {
    return makeCheck("private-adapter-health", "warn", { error: compactError(error) });
  }
}

function verdictFor(checks, config) {
  const failed = checks.filter((check) => check.status === "fail");
  const upstreamCheck = checks.find((check) => check.name === "private-adapter-health");
  const upstreamPending = upstreamCheck?.failures?.some((failure) => failure.includes("runtime_mode=behavior-adapter")) ||
    Object.keys(upstreamCheck?.runtimeCounts || {}).some((key) => key.includes(":behavior-adapter"));
  if (failed.length) return "failed";
  if (config.requireUpstreamLlm && upstreamPending) return "failed";
  if (upstreamPending) return "ready_with_upstream_llm_blocker";
  if (checks.some((check) => check.status === "warn")) return "ready_with_warnings";
  return "ready";
}

function receiptModeFor(config) {
  return config.requireUpstreamLlm ? "strict-upstream" : "adapter-mode";
}

function renderMarkdown(report) {
  const lines = [
    `# Save the Wildlife Model AI Readiness`,
    "",
    `- Generated: ${report.generatedAt}`,
    `- Base URL: ${report.baseUrl}`,
    `- Receipt mode: ${report.receiptMode}`,
    `- Verdict: ${report.verdict}`,
    `- Require upstream LLM: ${report.requireUpstreamLlm ? "yes" : "no"}`,
    "",
    `| Check | Status | Notes |`,
    `| --- | --- | --- |`,
  ];
  for (const check of report.checks) {
    const notes = [];
    if (check.failures?.length) notes.push(check.failures.join("; "));
    if (check.missing?.length) notes.push(`missing ${check.missing.join(", ")}`);
    if (check.error) notes.push(check.error.split("\n")[0]);
    if (check.providerCounts) {
      notes.push(`providers ${Object.entries(check.providerCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    }
    if (check.runtimeCounts) {
      notes.push(`runtimes ${Object.entries(check.runtimeCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    }
    if (check.upstreamFormatCounts) {
      notes.push(`upstream formats ${Object.entries(check.upstreamFormatCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`);
    }
    if (check.skipped) notes.push(check.reason || "skipped");
    lines.push(`| ${check.name} | ${check.status} | ${notes.join(" ") || "ok"} |`);
  }
  lines.push("");
  lines.push("## Demo Boundary");
  lines.push("");
  if (report.verdict === "ready_with_upstream_llm_blocker") {
    lines.push("- The harness, PAF route, admin proof, and DB-backed evidence checks are ready.");
    lines.push("- The private adapters expose a supported upstream handoff contract for evidence-bearing model calls.");
    lines.push("- The two-live-LLM claim is still blocked until both private routes report `runtime_mode=upstream-llm`.");
  } else if (report.verdict === "ready") {
    lines.push("- The demo readiness checks are fully green.");
  } else {
    lines.push("- Review failed or warning checks before using this as the main talk-track proof.");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = {
    baseUrl: normalizeBaseUrl(argValue("base-url", process.env.STWL_DEMO_BASE_URL || DEFAULT_BASE_URL)),
    timeoutMs: Number(argValue("timeout-ms", process.env.STWL_DEMO_READINESS_TIMEOUT_MS || "8000")),
    outputDir: argValue("output-dir", process.env.STWL_DEMO_READINESS_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
    kubeconfig: argValue("kubeconfig", process.env.KUBECONFIG || ".codex_tmp/kubeconfig"),
    namespace: argValue("namespace", process.env.STWL_DEMO_NAMESPACE || "default"),
    skipKube: hasFlag("skip-kube") || envBool("STWL_DEMO_SKIP_KUBE", false),
    requireUpstreamLlm: hasFlag("require-upstream-llm") || envBool("STWL_DEMO_REQUIRE_UPSTREAM_LLM", false),
  };

  const checks = [];
  checks.push(await checkPafHealth(config));
  checks.push(await checkAdminProof(config));
  checks.push(await checkLocalReports());
  checks.push(await checkTrainingExport());
  checks.push(await checkKubernetes(config));
  checks.push(await checkPrivateAdapterHealth(config));

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    namespace: config.namespace,
    receiptMode: receiptModeFor(config),
    requireUpstreamLlm: config.requireUpstreamLlm,
    verdict: verdictFor(checks, config),
    checks,
  };

  await fs.mkdir(repoPath(config.outputDir), { recursive: true });
  const jsonPath = path.join(repoPath(config.outputDir), "latest.json");
  const mdPath = path.join(repoPath(config.outputDir), "summary.md");
  const modeJsonPath = path.join(repoPath(config.outputDir), `${report.receiptMode}.json`);
  const modeMdPath = path.join(repoPath(config.outputDir), `${report.receiptMode}.md`);
  const renderedMarkdown = renderMarkdown(report);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderedMarkdown, "utf8");
  await fs.writeFile(modeJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(modeMdPath, renderedMarkdown, "utf8");

  console.log(`verdict=${report.verdict}`);
  console.log(`json=${path.relative(REPO_ROOT, jsonPath)}`);
  console.log(`summary=${path.relative(REPO_ROOT, mdPath)}`);
  console.log(`mode_json=${path.relative(REPO_ROOT, modeJsonPath)}`);
  console.log(`mode_summary=${path.relative(REPO_ROOT, modeMdPath)}`);

  const hasFailure = checks.some((check) => check.status === "fail");
  if (hasFailure || (config.requireUpstreamLlm && report.verdict !== "ready")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(compactError(error));
  process.exit(1);
});
