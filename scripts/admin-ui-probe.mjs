#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "admin-ui-probe");

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePlaywrightImport() {
  const explicit = process.env.PLAYWRIGHT_IMPORT_PATH;
  const candidates = [
    explicit,
    path.join(process.cwd(), "node_modules", "playwright", "index.mjs"),
    path.join(process.cwd(), "node_modules", "playwright", "index.js"),
    path.join(process.cwd(), "web", "node_modules", "playwright", "index.mjs"),
    path.join(process.cwd(), "web", "node_modules", "playwright", "index.js"),
    path.join(
      process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex"),
      "skills",
      "develop-web-game",
      "node_modules",
      "playwright",
      "index.mjs",
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error("Playwright is not available. Install it or set PLAYWRIGHT_IMPORT_PATH.");
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text: await response.text(),
    };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || String(error), text: "" };
  } finally {
    clearTimeout(timer);
  }
}

function parsePrometheusValues(text = "") {
  const values = {};
  String(text).split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/);
    if (match) values[match[1]] = Number(match[2]);
  });
  return values;
}

async function fetchJson(url, timeoutMs = 20000) {
  const payload = await fetchText(url, timeoutMs);
  try {
    return { ...payload, json: payload.text ? JSON.parse(payload.text) : null };
  } catch (error) {
    return { ...payload, json: null, parseError: error?.message || String(error) };
  }
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message || String(error) }));
  page.on("console", (msg) => {
    if (!["error", "warning"].includes(msg.type())) return;
    const text = msg.text();
    if (text.includes("/api/replay/events") || text.includes("504")) return;
    errors.push({ type: msg.type(), text });
  });
  return errors;
}

async function openAdminRoute({ browser, baseUrl, route, waitMs, outputDir, screenshotName }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  const errors = collectBrowserErrors(page);
  const assets = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.endsWith(".css") || url.includes("/bundle.")) {
      assets.push({
        url,
        status: response.status(),
        contentType: response.headers()["content-type"] || "",
      });
    }
  });
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#screen-admin", { state: "visible", timeout: 20000 });
  await page.waitForTimeout(waitMs);
  const state = await page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent?.trim() || "";
    const visible = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
    };
    return {
      bodyClass: document.body.className,
      observabilityVisible: visible("admin-observability"),
      aiVisible: visible("admin-ai-learning"),
      elements: {
        adminAiRuntime: !!document.getElementById("admin-ai-runtime"),
        adminAiHandoff: !!document.getElementById("admin-ai-handoff"),
        adminAiProofGate: !!document.getElementById("admin-ai-proof-gate"),
      },
      obs: {
        connections: text("obs-connections"),
        humans: text("obs-humans"),
        bots: text("obs-bots"),
        rooms: text("obs-rooms"),
        running: text("obs-running"),
        rtt: text("obs-rtt"),
        traffic: text("obs-traffic"),
        items: text("obs-items"),
        roomRows: Array.from(document.querySelectorAll("#admin-observability-rooms tr")).map((row) => row.textContent.trim()),
      },
      ai: {
        verdict: text("admin-ai-verdict"),
        runtime: text("admin-ai-runtime"),
        handoff: text("admin-ai-handoff"),
        proofGate: text("admin-ai-proof-gate"),
        noteTitle: text("admin-ai-note-title"),
        noteBody: text("admin-ai-note-body"),
        commentaryPlayers: text("admin-ai-commentary-players"),
        commentaryCount: text("admin-ai-commentary-count"),
        commentarySource: text("admin-ai-commentary-source"),
        empty: text("admin-commentary-empty"),
        feedText: text("admin-commentary-feed"),
        playerSections: document.querySelectorAll("#admin-commentary-feed .admin-commentary-player").length,
      },
    };
  });
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: false });
  await page.close();
  return { route, state, assets, errors };
}

function numericText(value) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const waitMs = Number(argValue("wait-ms", "12000"));
  const startedAt = new Date().toISOString();
  await fs.mkdir(outputDir, { recursive: true });

  const metrics = await fetchText(`${baseUrl}/metrics`, 15000);
  const metricValues = parsePrometheusValues(metrics.text || "");
  const pafHealth = await fetchJson(`${baseUrl}/paf/healthz?deep=1`, 30000);

  const { chromium } = await import(await resolvePlaywrightImport());
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
  });
  const checks = [];
  let observability;
  let aiLearning;
  try {
    observability = await openAdminRoute({
      browser,
      baseUrl,
      route: "/admin/observability",
      waitMs,
      outputDir,
      screenshotName: "admin-observability.png",
    });
    aiLearning = await openAdminRoute({
      browser,
      baseUrl,
      route: "/admin/ai-learning",
      waitMs,
      outputDir,
      screenshotName: "admin-ai-learning.png",
    });
  } finally {
    await browser.close().catch(() => {});
  }

  const obs = observability.state.obs;
  const ai = aiLearning.state.ai;
  const populatedObsFields = ["connections", "humans", "bots", "rooms", "running", "items"]
    .filter((field) => obs[field] && obs[field] !== "-");
  const missingObsFields = ["connections", "humans", "bots", "rooms", "running", "items"]
    .filter((field) => !obs[field] || obs[field] === "-");
  const metricsHasGameValues = [
    "stwl_players_total",
    "stwl_players_humans",
    "stwl_players_bots",
    "stwl_rooms_active",
    "stwl_items_trash",
  ].some((key) => Number.isFinite(metricValues[key]));

  checks.push({
    name: "observability panel visible",
    status: observability.state.observabilityVisible ? "pass" : "fail",
  });
  checks.push({
    name: "observability metrics populated",
    status: missingObsFields.length === 0 ? "pass" : "fail",
    populatedObsFields,
    missingObsFields,
    obs,
    metricsHasGameValues,
  });
  checks.push({
    name: "observability room table populated",
    status: obs.roomRows.some((row) => row && !/Waiting for room metrics/i.test(row)) ? "pass" : "fail",
    roomRows: obs.roomRows,
  });
  checks.push({
    name: "model ai panel visible",
    status: aiLearning.state.aiVisible ? "pass" : "fail",
  });
  checks.push({
    name: "model ai health resolved",
    status: ai.verdict
      && !/checking/i.test(ai.verdict)
      && aiLearning.state.elements.adminAiRuntime
      && aiLearning.state.elements.adminAiHandoff
      && aiLearning.state.elements.adminAiProofGate
      && ai.runtime
      && ai.handoff
      && ai.proofGate
      && !/checking/i.test(ai.proofGate)
      ? "pass"
      : "fail",
    ai,
    elements: aiLearning.state.elements,
    pafHealth: {
      ok: pafHealth.ok,
      status: pafHealth.status,
      version: pafHealth.json?.version,
      canvasConfigured: pafHealth.json?.canvas_configured,
      indbAgentEnabled: pafHealth.json?.indb_agent_enabled,
      genaiConfigured: pafHealth.json?.genai_configured,
      router: pafHealth.json?.router,
    },
  });
  const commentaryCount = numericText(ai.commentaryCount);
  checks.push({
    name: "commentary feed is inspectable",
    status: Number.isFinite(commentaryCount) && commentaryCount > 0
      ? "pass"
      : (ai.empty || ai.feedText || ai.playerSections >= 0 ? "warn" : "fail"),
    commentaryCount,
    ai,
  });
  const browserErrors = [...observability.errors, ...aiLearning.errors];
  checks.push({
    name: "admin browser errors",
    status: browserErrors.length ? "fail" : "pass",
    errors: browserErrors,
  });

  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length ? "fail" : (checks.some((check) => check.status === "warn") ? "warn" : "pass"),
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    waitMs,
    checks,
    metrics: {
      ok: metrics.ok,
      status: metrics.status,
      contentType: metrics.contentType,
      sample: Object.fromEntries(Object.entries(metricValues).filter(([key]) => key.startsWith("stwl_")).slice(0, 20)),
    },
    pafHealth: {
      ok: pafHealth.ok,
      status: pafHealth.status,
      contentType: pafHealth.contentType,
      json: pafHealth.json,
      parseError: pafHealth.parseError,
    },
    observability,
    aiLearning,
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Admin UI Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Wait: ${waitMs}ms`,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
