#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "model-ai-readiness");
const READINESS_SCRIPT = path.join("scripts", "model-ai-demo-readiness.mjs");

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function compactOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function runReadiness(args = [], { allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [READINESS_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(compactOutput(result) || `readiness exited ${result.status}`);
  }
  return {
    status: result.status,
    output: compactOutput(result),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.join(REPO_ROOT, filePath), "utf8"));
}

function checkNamed(report, name) {
  return report.checks.find((check) => check.name === name) || {};
}

function renderCounts(counts = {}) {
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(", ") : "none";
}

function renderCanaryRows(report) {
  const canary = checkNamed(report, "local-canary-reports");
  return (canary.reportSummaries || []).map((summary) => [
    `| ${summary.runId} | ${summary.tier} | ${summary.verdict} | ${summary.joined}/${summary.attempted} | ${summary.scoreRows} | ${summary.commentary} | ${summary.duplicates} | ${summary.p95Ms ?? "n/a"} ms | ${summary.reasons?.join(", ") || "none"} |`,
  ].join(""));
}

function renderRequiredTextList(admin = {}) {
  const missing = new Set(admin.missing || []);
  return (admin.requiredText || []).map((text) => `- ${missing.has(text) ? "Missing" : "Present"}: \`${text}\``);
}

function renderDeploymentRows(report) {
  const kube = checkNamed(report, "kubernetes-deployments");
  return (kube.deployments || []).map((deployment) => {
    const ready = `${deployment.ready}/${deployment.replicas}`;
    return `| ${deployment.name} | ${ready} | ${deployment.available}/${deployment.replicas} |`;
  });
}

function strictFailureIsExpected(report) {
  const failed = report.checks.filter((check) => check.status === "fail");
  if (report.verdict !== "failed") return false;
  if (failed.length !== 1 || failed[0].name !== "private-adapter-health") return false;
  const failures = failed[0].failures || [];
  return failures.length > 0 && failures.every((failure) => failure.includes("runtime_mode=behavior-adapter"));
}

function renderBundle({ adapterReport, strictReport, commands }) {
  const pafHealth = checkNamed(adapterReport, "paf-health");
  const adminProof = checkNamed(adapterReport, "admin-proof-ui");
  const adapterHealth = checkNamed(adapterReport, "private-adapter-health");
  const strictHealth = checkNamed(strictReport, "private-adapter-health");
  const training = checkNamed(adapterReport, "training-export-sample");
  const canaryRows = renderCanaryRows(adapterReport);
  const deploymentRows = renderDeploymentRows(adapterReport);
  const router = pafHealth.router || {};
  const strictExpected = strictFailureIsExpected(strictReport);

  const lines = [
    "# Save the Wildlife Model AI Proof Bundle",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Adapter-mode verdict: ${adapterReport.verdict}`,
    `- Strict-upstream verdict: ${strictReport.verdict}`,
    `- Strict blocker expected: ${strictExpected ? "yes" : "no"}`,
    "",
    "## Commands Run",
    "",
    "```text",
    "$ npm run check:model-ai-demo",
    commands.adapterFirst.output,
    "$ npm run check:model-ai-demo:strict",
    commands.strict.output,
    "$ npm run check:model-ai-demo",
    commands.adapterFinal.output,
    "```",
    "",
    "## Live Admin And Router Evidence",
    "",
    `- Base URL: ${adapterReport.baseUrl}`,
    `- Admin proof status: ${adminProof.status || "unknown"}`,
    `- PAF route mode: ${router.route_mode || "unknown"}`,
    `- Primary provider: ${router.primary_provider || "unknown"}`,
    `- Candidate provider: ${router.candidate_provider || "unknown"}`,
    `- Base endpoint configured: ${router.base_endpoint_configured === true ? "yes" : "no"}`,
    `- Fine-tuned endpoint configured: ${router.fine_tuned_endpoint_configured === true ? "yes" : "no"}`,
    `- Trace persistence: ${router.trace_persist === true ? "on" : "off"}`,
    `- Eval enabled: ${router.eval_enabled === true ? "on" : "off"}`,
    `- Training capture: ${router.training_capture_enabled === true ? "on" : "off"}`,
    `- Rubric version: ${router.rubric_version || "unknown"}`,
    "",
    "### Admin Proof Strings",
    "",
    ...(renderRequiredTextList(adminProof).length ? renderRequiredTextList(adminProof) : ["- No admin proof strings recorded"]),
    "",
    "## Deployment Evidence",
    "",
    "| Deployment | Ready | Available |",
    "| --- | ---: | ---: |",
    ...(deploymentRows.length ? deploymentRows : ["| unknown | 0/0 | 0/0 |"]),
    "",
    "## Canary Evidence",
    "",
    "| Run | Tier | Verdict | Joined | Score Rows | Commentary | Duplicates | p95 | Reasons |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...(canaryRows.length ? canaryRows : ["| missing | 0 | missing | 0/0 | 0 | 0 | 0 | n/a | no canary rows |"]),
    "",
    "## Model Route Evidence",
    "",
    `- Adapter providers: ${renderCounts(adapterHealth.providerCounts)}`,
    `- Adapter runtimes: ${renderCounts(adapterHealth.runtimeCounts)}`,
    `- Upstream handoff formats: ${renderCounts(adapterHealth.upstreamFormatCounts)}`,
    `- Strict failure details: ${(strictHealth.failures || []).join("; ") || "none"}`,
    "",
    "## Training Evidence",
    "",
    `- Training export file: ${training.file || "missing"}`,
    `- Behavior examples: ${training.example_count ?? "unknown"}`,
    `- Sample provider: ${training.provider || "unknown"}`,
    `- Prompt redacted: ${training.prompt_text_redacted === true ? "yes" : "unknown"}`,
    `- Citation count: ${training.citation_count ?? "unknown"}`,
    "",
    "## Claim Boundary",
    "",
    "- Adapter-mode proves the PAF/Oracle AI Database harness, tier-1000 load gate, score-row proof, trace/eval metadata, training capture, and OpenAI-compatible handoff.",
    "- It does not prove two live private LLM runtimes.",
    "- The two-live-LLM claim becomes valid only after both private routes report `runtime_mode=upstream-llm` and strict upstream canary passes.",
    "",
  ];

  return `${lines.join("\n")}`;
}

async function main() {
  const outputDir = argValue("output-dir", process.env.STWL_DEMO_READINESS_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const passthroughArgs = process.argv.slice(2).filter((arg, index, args) => {
    if (arg === "--output-dir") return false;
    if (args[index - 1] === "--output-dir") return false;
    return !arg.startsWith("--output-dir=");
  });
  const outputArgs = ["--output-dir", outputDir, ...passthroughArgs];

  const adapterFirst = runReadiness(outputArgs);
  const strict = runReadiness([...outputArgs, "--require-upstream-llm"], { allowFailure: true });
  const adapterFinal = runReadiness(outputArgs);

  const adapterReport = await readJson(path.join(outputDir, "adapter-mode.json"));
  const strictReport = await readJson(path.join(outputDir, "strict-upstream.json"));
  const bundle = renderBundle({
    adapterReport,
    strictReport,
    commands: { adapterFirst, strict, adapterFinal },
  });
  await fs.mkdir(path.join(REPO_ROOT, outputDir), { recursive: true });
  const bundlePath = path.join(outputDir, "proof-bundle.md");
  await fs.writeFile(path.join(REPO_ROOT, bundlePath), bundle, "utf8");

  console.log(`adapter_verdict=${adapterReport.verdict}`);
  console.log(`strict_verdict=${strictReport.verdict}`);
  console.log(`proof_bundle=${bundlePath}`);

  if (adapterReport.verdict !== "ready_with_upstream_llm_blocker" && adapterReport.verdict !== "ready") {
    process.exitCode = 1;
  }
  if (!strictFailureIsExpected(strictReport) && strictReport.verdict !== "ready") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
