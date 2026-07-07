#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "multiplayer-sync-probe");
const DEFAULT_PLAYERS = ["QAHumanA", "QAHumanB", "QAHumanC"];

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

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message }));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (text.includes("/api/replay/events") || text.includes("504")) return;
    errors.push({ type: "console.error", text });
  });
  return errors;
}

async function waitForRenderState(page, predicate, timeoutMs) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, {
    timeout: Math.max(timeoutMs, 120000),
  });
  await page.waitForFunction((predicateSource) => {
    try {
      const state = JSON.parse(window.render_game_to_text());
      return Function("state", `return (${predicateSource})(state);`)(state);
    } catch {
      return false;
    }
  }, predicate.toString(), { timeout: timeoutMs });
}

async function captureState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

function humanNamesSeenBy(state, ownName, allNames) {
  const expectedRemoteNames = allNames.filter((name) => name !== ownName);
  const samples = Array.isArray(state.remotePlayerSamples) ? state.remotePlayerSamples : [];
  const visibleHumanNames = samples
    .filter((sample) => sample && sample.isBot !== true)
    .map((sample) => String(sample.name || sample.id || ""));
  return {
    expectedRemoteNames,
    visibleHumanNames,
    missingRemoteNames: expectedRemoteNames.filter((name) => !visibleHumanNames.includes(name)),
    nonBotRemoteCount: visibleHumanNames.length,
  };
}

function movementDelta(before, after) {
  if (!before || !after) return null;
  const dx = Number(after.x || 0) - Number(before.x || 0);
  const dz = Number(after.z || 0) - Number(before.z || 0);
  const dr = Number(after.rotY || 0) - Number(before.rotY || 0);
  return {
    dx: Number(dx.toFixed(3)),
    dz: Number(dz.toFixed(3)),
    dr: Number(dr.toFixed(3)),
    distance: Number(Math.hypot(dx, dz).toFixed(3)),
  };
}

async function openClient({ chromium, baseUrl, room, name, outputDir, timeoutMs, mobile }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
  });
  const context = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page);
  const url = `${baseUrl}/?name=${encodeURIComponent(name)}&room=${encodeURIComponent(room)}&autostart=1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForRenderState(page, (state) => state && state.mode === "RUNNING", timeoutMs);
  await page.screenshot({ path: path.join(outputDir, `${name}-running.png`), fullPage: true });
  return { browser, context, page, errors, name, mobile, url };
}

async function driveClient(page, durationMs) {
  await page.bringToFront();
  await page.click("canvas", { timeout: 5000 }).catch(() => {});
  await page.keyboard.down("w");
  await page.keyboard.down("a");
  await page.waitForTimeout(Math.max(500, durationMs));
  await page.keyboard.up("a").catch(() => {});
  await page.keyboard.up("w").catch(() => {});
  await page.waitForTimeout(1200);
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "120000"));
  const driveMs = Number(argValue("drive-ms", "2500"));
  const room = argValue("room", `QA-MULTI-${Date.now().toString().slice(-6)}`);
  const includeMobile = hasFlag("include-mobile");
  const names = String(argValue("players", DEFAULT_PLAYERS.join(",")))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (names.length < 2) throw new Error("At least two player names are required.");

  await fs.mkdir(outputDir, { recursive: true });
  const { chromium } = await import(await resolvePlaywrightImport());
  const clients = [];
  const startedAt = new Date().toISOString();
  const checks = [];
  let failure = null;

  try {
    for (const [idx, name] of names.entries()) {
      clients.push(await openClient({
        chromium,
        baseUrl,
        room,
        name,
        outputDir,
        timeoutMs,
        mobile: includeMobile && idx === names.length - 1,
      }));
      await clients[idx].page.waitForTimeout(700);
    }

    const before = {};
    for (const client of clients) before[client.name] = await captureState(client.page);

    await driveClient(clients[0].page, driveMs);
    await clients[0].page.waitForTimeout(1500);

    const after = {};
    for (const client of clients) {
      after[client.name] = await captureState(client.page);
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-after-drive.png`), fullPage: true });
    }

    const driverDelta = movementDelta(before[clients[0].name]?.player, after[clients[0].name]?.player);
    const driverMoved = !!driverDelta && (driverDelta.distance > 0.05 || Math.abs(driverDelta.dr) > 0.02);
    checks.push({
      name: "driver local movement",
      status: driverMoved ? "pass" : "fail",
      driver: clients[0].name,
      delta: driverDelta,
    });

    for (const client of clients) {
      const visibility = humanNamesSeenBy(after[client.name], client.name, names);
      const status = visibility.missingRemoteNames.length === 0 ? "pass" : "fail";
      checks.push({
        name: `${client.name} sees human remotes`,
        status,
        ...visibility,
        remotePlayerSamples: after[client.name]?.remotePlayerSamples || [],
        authStateCount: after[client.name]?.authStateCount || 0,
        authStateSamples: after[client.name]?.authStateSamples || [],
      });
    }

    for (const client of clients) {
      if (client.errors.length > 0) {
        checks.push({ name: `${client.name} browser errors`, status: "fail", errors: client.errors });
      } else {
        checks.push({ name: `${client.name} browser errors`, status: "pass" });
      }
    }

    const failed = checks.filter((check) => check.status === "fail");
    const result = {
      status: failed.length === 0 ? "pass" : "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      names,
      includeMobile,
      checks,
      before,
      after,
    };

    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    const lines = [
      `# Multiplayer Sync Probe`,
      ``,
      `- Status: ${statusIcon(result.status)}`,
      `- Base URL: \`${baseUrl}\``,
      `- Room: \`${room}\``,
      `- Players: ${names.map((name) => `\`${name}\``).join(", ")}`,
      `- Mobile client included: ${includeMobile ? "yes" : "no"}`,
      ``,
      `## Checks`,
      ...checks.map((check) => `- ${statusIcon(check.status)} ${check.name}${check.missingRemoteNames ? `; missing=${check.missingRemoteNames.join(",") || "none"}; nonBotRemoteCount=${check.nonBotRemoteCount}` : ""}`),
      ``,
      `## Evidence`,
      ...names.flatMap((name) => [
        `- \`${name}-running.png\``,
        `- \`${name}-after-drive.png\``,
      ]),
    ];
    await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    failure = error;
    const result = {
      status: "fail",
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl,
      room,
      names,
      includeMobile,
      error: error && error.stack ? error.stack : String(error),
      checks,
    };
    await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);
    await fs.writeFile(path.join(outputDir, "latest.md"), `# Multiplayer Sync Probe\n\n- Status: FAIL\n- Error: ${String(error && error.message ? error.message : error)}\n`);
    process.exitCode = 1;
  } finally {
    for (const client of clients.reverse()) {
      await client.browser.close().catch(() => {});
    }
    if (failure) console.error(failure);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
