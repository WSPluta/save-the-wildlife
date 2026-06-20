#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "conference-game-smoke");
const DEFAULT_SCENARIO = "both";

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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
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
      "index.mjs"
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(
    "Playwright is not available. Install it or set PLAYWRIGHT_IMPORT_PATH to a playwright index module."
  );
}

function scenarioUrl(baseUrl, prefix, roomOverride = "") {
  const room = roomOverride || `${prefix}-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    room,
    url: `${baseUrl}/?name=${prefix}Smoke&room=${room}&autostart=1`,
  };
}

function isIgnoredConsoleError(text) {
  return text.includes("/api/replay/events") || text.includes("504");
}

async function waitForRenderState(page, predicate, timeout = 90000) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, {
    timeout: Math.max(timeout, 120000),
  });
  await page.waitForFunction((predicateSource) => {
    try {
      const state = JSON.parse(window.render_game_to_text());
      return Function("state", `return (${predicateSource})(state);`)(state);
    } catch {
      return false;
    }
  }, predicate.toString(), { timeout });
}

async function captureState(page) {
  return page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text());
    const canvas = document.querySelector("canvas");
    const canvasRect = canvas ? canvas.getBoundingClientRect() : null;
    const joystick = document.getElementById("touch-joystick");
    const joystickStyle = joystick ? getComputedStyle(joystick) : null;
    const joystickRect = joystick ? joystick.getBoundingClientRect() : null;
    return {
      state,
      bodyClass: document.body.className,
      canvas: canvasRect ? {
        width: canvasRect.width,
        height: canvasRect.height,
        left: canvasRect.left,
        top: canvasRect.top,
      } : null,
      joystick: joystick && joystickStyle && joystickRect ? {
        display: joystickStyle.display,
        visibility: joystickStyle.visibility,
        opacity: joystickStyle.opacity,
        width: joystickRect.width,
        height: joystickRect.height,
        left: joystickRect.left,
        top: joystickRect.top,
      } : null,
    };
  });
}

function collectBrowserErrors(page) {
  let errors = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message }));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnoredConsoleError(text)) return;
    errors.push({ type: "console.error", text });
  });
  return errors;
}

function validateCommon(state, failures, options = {}) {
  if (state.mode !== "RUNNING") failures.push(`expected RUNNING, got ${state.mode}`);
  if ((state.itemsVisible || 0) <= 0) failures.push("expected visible items");
  if ((state.trashInstances || 0) < 4) failures.push(`expected at least 4 trash instances, got ${state.trashInstances || 0}`);
  if (options.requireBots) {
    if ((state.botsVisible || 0) < 1) failures.push(`expected at least 1 visible bot, got ${state.botsVisible || 0}`);
    if (state.botRenderMode !== "demo-visible") failures.push(`expected botRenderMode=demo-visible, got ${state.botRenderMode || "missing"}`);
  }
  const visiblePowerups = Number(state.powerupInstances || 0);
  const activePowerups = activePowerupEffectCount(state);
  if (visiblePowerups + activePowerups < 1) {
    failures.push(`expected at least 1 visible or active powerup, got visible=${visiblePowerups} active=${activePowerups}`);
  }
  if (!state.boatFeel || !Number.isFinite(Number(state.boatFeel.y))) failures.push("missing finite boatFeel.y");
  if (state.boatFeel) {
    const boatY = Number(state.boatFeel.y || 0);
    if (boatY > -0.007) failures.push(`boat visual y is too high above the waterline: ${state.boatFeel.y}`);
    if (boatY < -0.034) failures.push(`boat visual y is too deeply submerged: ${state.boatFeel.y}`);
  }
  if (state.waterlineContact && state.waterlineContact.visible !== true) {
    failures.push("expected visible waterline contact");
  }
  if (state.waterlineContact && Number.isFinite(Number(state.waterlineContact.seatDepth))) {
    const seatDepth = Number(state.waterlineContact.seatDepth);
    if (seatDepth < 0.012) failures.push(`boat waterline seat depth too shallow: ${seatDepth}`);
    if (seatDepth > 0.04) failures.push(`boat waterline seat depth too deep: ${seatDepth}`);
  }
}

function activePowerupEffectCount(state) {
  const powerUps = state?.powerUps || {};
  let count = 0;
  if (Number(powerUps.speed || 1) > 1) count++;
  if (powerUps.shield === true) count++;
  if (powerUps.magnet === true) count++;
  if (powerUps.freeze === true) count++;
  return count;
}

async function runMobile({ chromium, baseUrl, outputDir, timeoutMs, roomOverride, requireBots }) {
  const { room, url } = scenarioUrl(baseUrl, "MOBILE", roomOverride);
  const screenshotDir = path.join(outputDir, "mobile");
  await fs.mkdir(screenshotDir, { recursive: true });
  let browser;
  let page;
  let errors = [];
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    page = await context.newPage();
    errors = collectBrowserErrors(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForRenderState(page, (state) => state.mode === "RUNNING", timeoutMs);
    await page.waitForTimeout(1200);
    const result = await captureState(page);
    await page.screenshot({ path: path.join(screenshotDir, "running.png"), fullPage: true });
    const failures = [...errors.map((error) => `${error.type}: ${error.text}`)];
    validateCommon(result.state, failures, { requireBots });
    if (!result.joystick || result.joystick.display === "none" || result.joystick.visibility === "hidden") {
      failures.push("mobile joystick is hidden");
    }
    if (result.joystick && (result.joystick.width < 90 || result.joystick.height < 90)) {
      failures.push(`mobile joystick too small: ${result.joystick.width}x${result.joystick.height}`);
    }
    const nearestTrash = Number(result.state.trashSamples?.[0]?.distance);
    if (Number.isFinite(nearestTrash) && nearestTrash < 3.5) {
      failures.push(`nearest trash is too close to mobile start: ${nearestTrash}`);
    }
    return makeCheck("mobile-gameplay", failures.length ? "fail" : "pass", {
      failures,
      room,
      url,
      screenshot: path.join(screenshotDir, "running.png"),
      state: result.state,
      joystick: result.joystick,
    });
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(screenshotDir, "failure.png"), fullPage: true }).catch(() => {});
    return makeCheck("mobile-gameplay", "fail", {
      room,
      url,
      screenshot: path.join(screenshotDir, "failure.png"),
      error: error.stack || error.message || String(error),
      browser_errors: errors,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function runDesktop({ chromium, baseUrl, outputDir, timeoutMs, roomOverride, requireBots }) {
  const { room, url } = scenarioUrl(baseUrl, "DESKTOP", roomOverride);
  const screenshotDir = path.join(outputDir, "desktop");
  await fs.mkdir(screenshotDir, { recursive: true });
  let browser;
  let page;
  let errors = [];
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    errors = collectBrowserErrors(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForRenderState(page, (state) => state.mode === "RUNNING", timeoutMs);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(900);
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(1200);
    const result = await captureState(page);
    await page.screenshot({ path: path.join(screenshotDir, "running.png"), fullPage: true });
    const failures = [...errors.map((error) => `${error.type}: ${error.text}`)];
    validateCommon(result.state, failures, { requireBots });
    if ((result.state.environmentPropsVisible || 0) < 10) {
      failures.push(`expected desktop environment props, got ${result.state.environmentPropsVisible || 0}`);
    }
    if (!result.state.wakeRipples || (result.state.wakeRipples.visible || 0) < 2) {
      failures.push(`expected visible wake ripples, got ${JSON.stringify(result.state.wakeRipples || {})}`);
    }
    if (result.state.boatFeel) {
      if (Math.abs(result.state.boatFeel.pitch || 0) > 0.09) failures.push(`pitch clamp exceeded: ${result.state.boatFeel.pitch}`);
      if (Math.abs(result.state.boatFeel.roll || 0) > 0.16) failures.push(`roll clamp exceeded: ${result.state.boatFeel.roll}`);
    }
    return makeCheck("desktop-gameplay", failures.length ? "fail" : "pass", {
      failures,
      room,
      url,
      screenshot: path.join(screenshotDir, "running.png"),
      state: result.state,
      canvas: result.canvas,
    });
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(screenshotDir, "failure.png"), fullPage: true }).catch(() => {});
    return makeCheck("desktop-gameplay", "fail", {
      room,
      url,
      screenshot: path.join(screenshotDir, "failure.png"),
      error: error.stack || error.message || String(error),
      browser_errors: errors,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function finalVerdict(checks) {
  if (checks.some((check) => check.status === "fail")) return "failed";
  if (checks.some((check) => check.status === "warn")) return "ready_with_caveats";
  return "ready";
}

function isBrowserLaunchBlocked(errorText) {
  const text = String(errorText || "");
  return text.includes("browserType.launch")
    && (
      text.includes("bootstrap_check_in")
      || text.includes("MachPortRendezvous")
      || text.includes("Permission denied")
    );
}

function isLocalProofBrowserBlocked(report) {
  const failed = (report.checks || []).filter((check) => check.status === "fail");
  return failed.length > 0 && failed.every((check) => isBrowserLaunchBlocked(check.error));
}

function nearestTrashDistance(state) {
  const distances = (state?.trashSamples || [])
    .map((sample) => Number(sample?.distance))
    .filter((distance) => Number.isFinite(distance));
  if (!distances.length) return null;
  return Math.min(...distances);
}

function renderCheckDetails(check) {
  const lines = [];
  if (check.url) lines.push(`- URL: ${check.url}`);
  if (check.screenshot) lines.push(`- Screenshot: ${check.screenshot}`);
  if (check.state) {
    lines.push(`- Mode: ${check.state.mode}`);
    const activePowerups = activePowerupEffectCount(check.state);
    const activeSuffix = activePowerups ? `, active effects ${activePowerups}` : "";
    lines.push(`- Items: ${check.state.itemsVisible || 0}, trash ${check.state.trashInstances || 0}, powerups ${check.state.powerupInstances || 0}${activeSuffix}`);
    lines.push(`- Bots: visible ${check.state.botsVisible || 0}, known ${check.state.botsKnown || 0}, mode ${check.state.botRenderMode || "unknown"}`);
    const nearestTrash = nearestTrashDistance(check.state);
    if (nearestTrash !== null) lines.push(`- Nearest trash distance: ${nearestTrash}`);
    lines.push(`- Boat feel: ${JSON.stringify(check.state.boatFeel || {})}`);
    lines.push(`- Waterline contact: ${JSON.stringify(check.state.waterlineContact || {})}`);
    lines.push(`- Wake ripples: ${JSON.stringify(check.state.wakeRipples || {})}`);
    lines.push(`- Turtles visible: ${check.state.turtlesVisible || 0}`);
  }
  if (check.joystick) lines.push(`- Joystick: ${Math.round(check.joystick.width)}x${Math.round(check.joystick.height)} at ${Math.round(check.joystick.left)},${Math.round(check.joystick.top)}`);
  if (check.canvas) lines.push(`- Canvas: ${Math.round(check.canvas.width)}x${Math.round(check.canvas.height)}`);
  if (check.error) lines.push(`- Error: ${String(check.error).split("\n")[0]}`);
  if (check.failures?.length) {
    lines.push("- Failures:");
    for (const failure of check.failures) lines.push(`  - ${failure}`);
  }
  return lines;
}

function renderMarkdown(report) {
  const lines = [
    "# Save the Wildlife Conference Game Smoke",
    "",
    `- Generated: ${report.generated_at}`,
    `- Base URL: ${report.base_url}`,
    `- Scenario: ${report.scenario}`,
    `- Verdict: ${report.verdict}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`### ${statusIcon(check.status)} ${check.name}`);
    lines.push("");
    lines.push(...renderCheckDetails(check));
    lines.push("");
  }
  lines.push("## Presenter Reading");
  lines.push("");
  lines.push("- Use this receipt to prove the playable/mobile experience, not the AI path.");
  lines.push("- Pair it with `.codex_tmp/conference-preflight/latest.md` for PAF, Oracle AI Database, and model-route proof.");
  lines.push("");
  return `${lines.join("\n")}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", process.env.STWL_DEMO_BASE_URL || DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", process.env.STWL_CONFERENCE_GAME_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const scenario = argValue("scenario", process.env.STWL_CONFERENCE_GAME_SCENARIO || DEFAULT_SCENARIO);
  const timeoutMs = Number(argValue("timeout-ms", process.env.STWL_DEMO_TIMEOUT_MS || "90000"));
  const roomOverride = argValue("room", process.env.STWL_CONFERENCE_GAME_ROOM || "");
  const requireBots = hasFlag("require-bots") || /^(1|true|yes|on)$/i.test(process.env.STWL_REQUIRE_BOTS || "");
  if (!["mobile", "desktop", "both"].includes(scenario)) {
    throw new Error(`Unsupported scenario ${scenario}; expected mobile, desktop, or both`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  const playwrightImport = await resolvePlaywrightImport();
  const { chromium } = await import(playwrightImport);
  const checks = [];
  if (scenario === "mobile" || scenario === "both") {
    checks.push(await runMobile({ chromium, baseUrl, outputDir, timeoutMs, roomOverride, requireBots }));
  }
  if (scenario === "desktop" || scenario === "both") {
    checks.push(await runDesktop({ chromium, baseUrl, outputDir, timeoutMs, roomOverride, requireBots }));
  }

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    scenario,
    room_override: roomOverride || null,
    require_bots: requireBots,
    verdict: finalVerdict(checks),
    playwright_import: playwrightImport,
    checks,
  };
  const jsonPath = path.join(outputDir, "latest.json");
  const mdPath = path.join(outputDir, "latest.md");
  const readyJsonPath = path.join(outputDir, "last-ready.json");
  const readyMdPath = path.join(outputDir, "last-ready.md");
  const blockedJsonPath = path.join(outputDir, "last-browser-blocked.json");
  const blockedMdPath = path.join(outputDir, "last-browser-blocked.md");
  const previousLatest = await readJsonIfExists(jsonPath);
  const preserveLatest = report.verdict === "failed"
    && isLocalProofBrowserBlocked(report)
    && previousLatest?.verdict === "ready";

  if (preserveLatest) {
    await fs.writeFile(blockedJsonPath, JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(blockedMdPath, renderMarkdown(report), "utf8");
  } else {
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(mdPath, renderMarkdown(report), "utf8");
  }

  if (report.verdict === "ready") {
    await fs.writeFile(readyJsonPath, JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(readyMdPath, renderMarkdown(report), "utf8");
  }

  for (const check of checks) {
    console.log(`${statusIcon(check.status)} ${check.name}`);
  }
  console.log(`verdict=${report.verdict}`);
  console.log(`json=${preserveLatest ? blockedJsonPath : jsonPath}`);
  console.log(`summary=${preserveLatest ? blockedMdPath : mdPath}`);
  if (report.verdict === "ready") {
    console.log(`last_ready_json=${readyJsonPath}`);
    console.log(`last_ready_summary=${readyMdPath}`);
  }
  if (preserveLatest) {
    console.log(`latest_preserved=${jsonPath}`);
    console.log(`browser_blocked_json=${blockedJsonPath}`);
    console.log(`browser_blocked_summary=${blockedMdPath}`);
  }

  if (report.verdict === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
