#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "admin-observability-stability");

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

async function fetchText(url, timeoutMs = 12000) {
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

async function fetchJson(url, timeoutMs = 12000) {
  const payload = await fetchText(url, timeoutMs);
  if (!payload.ok) return { ...payload, json: null };
  try {
    return { ...payload, json: JSON.parse(payload.text || "{}") };
  } catch (error) {
    return { ...payload, ok: false, parseError: error?.message || String(error), json: null };
  }
}

function parsePrometheusValues(text = "") {
  const values = {};
  String(text).split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) return;
    const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/);
    if (!match) return;
    const key = match[1];
    const value = Number(match[2]);
    if (!Number.isFinite(value)) return;
    values[key] = (values[key] || 0) + value;
  });
  return values;
}

function numericText(value) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function range(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return { count: 0, values: [] };
  return {
    count: finite.length,
    min: Math.min(...finite),
    max: Math.max(...finite),
    distinct: [...new Set(finite)].sort((a, b) => a - b),
  };
}

function itemTotal(items = {}) {
  return Number(items.trash || 0) + Number(items.marine || 0) + Number(items.powerups || 0);
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
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const url = response.url();
    if (url.includes("/api/replay/events")) return;
    errors.push({ type: "http", status: response.status(), url });
  });
  return errors;
}

async function readAdminState(page) {
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent?.trim() || "";
    return {
      connections: text("obs-connections"),
      humans: text("obs-humans"),
      bots: text("obs-bots"),
      rooms: text("obs-rooms"),
      running: text("obs-running"),
      rtt: text("obs-rtt"),
      traffic: text("obs-traffic"),
      items: text("obs-items"),
      roomRows: Array.from(document.querySelectorAll("#admin-observability-rooms tr")).map((row) => row.textContent.trim()),
    };
  });
}

function summarizeSample(sample) {
  const observability = sample.observability || {};
  const global = observability.global || {};
  const selectedRoom = observability.selectedRoom || {};
  const selectedMetrics = selectedRoom.metrics || {};
  return {
    at: sample.at,
    dom: {
      rooms: numericText(sample.dom?.rooms),
      running: numericText(sample.dom?.running),
      humans: numericText(sample.dom?.humans),
      bots: numericText(sample.dom?.bots),
      connections: numericText(sample.dom?.connections),
      items: numericText(sample.dom?.items),
      rowCount: sample.dom?.roomRows?.length || 0,
    },
    canonical: {
      ok: observability.ok !== false,
      source: observability.source,
      roomsActive: global.rooms?.active,
      roomsStarting: global.rooms?.starting,
      roomsRunning: global.rooms?.running,
      playersTotal: global.players?.total,
      playersHumans: global.players?.humans,
      playersBots: global.players?.bots,
      selectedItemsTotal: itemTotal(selectedRoom.items || selectedMetrics.items || {}),
      selectedItemsTrash: (selectedRoom.items || selectedMetrics.items || {}).trash,
      selectedItemsMarine: (selectedRoom.items || selectedMetrics.items || {}).marine,
      selectedItemsPowerups: (selectedRoom.items || selectedMetrics.items || {}).powerups,
      globalItemsTotal: itemTotal(global.items || {}),
    },
  };
}

function staleActiveRows(samples) {
  const rows = new Set();
  for (const sample of samples) {
    for (const row of sample.dom?.roomRows || []) {
      if (/QA-|ROOM-/.test(row) && /(STARTING|RUNNING)/.test(row)) rows.add(row);
    }
  }
  return [...rows].sort();
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const samplesCount = Number(argValue("samples", "12"));
  const intervalMs = Number(argValue("interval-ms", "3000"));
  await fs.mkdir(outputDir, { recursive: true });
  const { chromium } = await import(await resolvePlaywrightImport());
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  const errors = collectBrowserErrors(page);
  const samples = [];

  try {
    await page.goto(`${baseUrl}/admin/observability`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("#screen-admin", { state: "visible", timeout: 20000 });
    await page.waitForTimeout(3000);
    for (let i = 0; i < samplesCount; i++) {
      const roomParam = encodeURIComponent("ROOM-0001");
      const [dom, observabilityPayload] = await Promise.all([
        readAdminState(page).catch((error) => ({ error: error?.message || String(error) })),
        fetchJson(`${baseUrl}/api/observability?room=${roomParam}`, 12000),
      ]);
      samples.push({
        at: new Date().toISOString(),
        index: i + 1,
        dom,
        observabilityStatus: observabilityPayload.status,
        observabilityOk: observabilityPayload.ok,
        observability: observabilityPayload.json,
      });
      if (i < samplesCount - 1) await sleep(intervalMs);
    }
    await page.screenshot({ path: path.join(outputDir, "admin-observability-final.png"), fullPage: false }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const compact = samples.map(summarizeSample);
  const domRoomsRange = range(compact.map((sample) => sample.dom.rooms));
  const domItemsRange = range(compact.map((sample) => sample.dom.items));
  const canonicalRoomsRange = range(compact.map((sample) => sample.canonical.roomsActive));
  const canonicalItemsRange = range(compact.map((sample) => sample.canonical.selectedItemsTotal));
  const domVsCanonicalDeltas = compact.map((sample) => ({
    at: sample.at,
    roomsDelta: Number.isFinite(sample.dom.rooms) && Number.isFinite(sample.canonical.roomsActive)
      ? sample.canonical.roomsActive - sample.dom.rooms
      : null,
    itemsDelta: Number.isFinite(sample.dom.items) && Number.isFinite(sample.canonical.selectedItemsTotal)
      ? sample.canonical.selectedItemsTotal - sample.dom.items
      : null,
  }));
  const checks = [
    {
      name: "admin observability samples collected",
      status: samples.length === samplesCount ? "pass" : "fail",
      samples: samples.length,
    },
    {
      name: "canonical observability API samples collected",
      status: samples.every((sample) => sample.observabilityOk && sample.observability?.ok !== false) ? "pass" : "fail",
      statuses: samples.map((sample) => sample.observabilityStatus),
      sources: [...new Set(samples.map((sample) => sample.observability?.source).filter(Boolean))],
    },
    {
      name: "admin browser errors",
      status: errors.length ? "fail" : "pass",
      errors,
    },
    {
      name: "DOM counters stable during observation window",
      status: (domRoomsRange.max - domRoomsRange.min) <= 2 && (domItemsRange.max - domItemsRange.min) <= 5 ? "pass" : "fail",
      domRoomsRange,
      domItemsRange,
    },
    {
      name: "canonical counters stable during observation window",
      status: (canonicalRoomsRange.max - canonicalRoomsRange.min) <= 2 && (canonicalItemsRange.max - canonicalItemsRange.min) <= 5 ? "pass" : "fail",
      canonicalRoomsRange,
      canonicalItemsRange,
    },
    {
      name: "DOM counters agree with canonical scoped observability",
      status: domVsCanonicalDeltas.every((entry) => {
        if (entry.roomsDelta == null || entry.itemsDelta == null) return false;
        return Math.abs(entry.roomsDelta) <= 2 && Math.abs(entry.itemsDelta) <= 5;
      }) ? "pass" : "fail",
      deltas: domVsCanonicalDeltas,
    },
    {
      name: "no stale active QA rooms visible",
      status: staleActiveRows(samples).length === 0 ? "pass" : "fail",
      staleRows: staleActiveRows(samples),
    },
  ];
  const failed = checks.filter((check) => check.status === "fail");
  const result = {
    status: failed.length ? "fail" : "pass",
    startedAt: samples[0]?.at || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl,
    samplesCount,
    intervalMs,
    checks,
    compact,
    samples,
  };

  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    "# Admin Observability Stability Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Samples: ${samplesCount} every ${intervalMs}ms`,
    "",
    "## Checks",
    ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}`),
    "",
    "## Ranges",
    `- DOM rooms: ${JSON.stringify(domRoomsRange.distinct)}`,
    `- DOM items: ${JSON.stringify(domItemsRange.distinct)}`,
    `- Canonical rooms: ${JSON.stringify(canonicalRoomsRange.distinct)}`,
    `- Canonical selected-room items: ${JSON.stringify(canonicalItemsRange.distinct)}`,
  ];
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
