#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "gameplay-visual-qa");

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
      "index.mjs"
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error("Playwright is not available. Install it or set PLAYWRIGHT_IMPORT_PATH.");
}

function scenarioUrl(baseUrl, prefix) {
  const room = `${prefix}-QA-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    room,
    url: `${baseUrl}/?name=${prefix}VisualQA&room=${room}&autostart=1&visualQa=1`,
  };
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

async function waitForRunning(page, timeoutMs) {
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
  await page.waitForFunction(() => {
    try {
      return JSON.parse(window.render_game_to_text()).mode === "RUNNING";
    } catch {
      return false;
    }
  }, null, { timeout: timeoutMs });
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
      canvas: canvasRect ? {
        width: canvasRect.width,
        height: canvasRect.height,
        left: canvasRect.left,
        top: canvasRect.top,
      } : null,
      joystick: joystick && joystickStyle && joystickRect ? {
        display: joystickStyle.display,
        visibility: joystickStyle.visibility,
        width: joystickRect.width,
        height: joystickRect.height,
        left: joystickRect.left,
        top: joystickRect.top,
      } : null,
    };
  });
}

async function enableBadgeProbe(page) {
  await page.waitForFunction(() => Boolean(window.__stwlVisualQa?.showBadges), null, { timeout: 20000 });
  await page.evaluate(() => window.__stwlVisualQa.showBadges());
  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(window.render_game_to_text());
      return state.badges?.powerup?.visible === true && state.badges?.status?.visible === true;
    } catch {
      return false;
    }
  }, null, { timeout: 10000 });
}

function approxEqual(actual, expected, epsilon = 0.01) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

function validateCommon(state, failures, expectedBadgeLayout) {
  if (state.mode !== "RUNNING") failures.push(`expected RUNNING, got ${state.mode}`);
  if ((state.trashInstances || 0) < 4) failures.push(`expected at least 4 trash instances, got ${state.trashInstances || 0}`);
  if ((state.itemsVisible || 0) <= 0) failures.push("expected visible items");
  if (Number(state.powerupInstances || 0) < 1) failures.push(`expected visible powerup, got ${state.powerupInstances || 0}`);
  if ((state.environmentPropsVisible || 0) < expectedBadgeLayout.minEnvironmentProps) {
    failures.push(`expected environment props >=${expectedBadgeLayout.minEnvironmentProps}, got ${state.environmentPropsVisible || 0}`);
  }
  const pickupRadii = state.pickupRadii || {};
  if (Number(pickupRadii.trash) < 5 || Number(pickupRadii.powerup) < 5) {
    failures.push(`pickup radii look too small: ${JSON.stringify(pickupRadii)}`);
  }
  for (const sample of state.trashSamples || []) {
    const scale = Number(sample.visualScale);
    if (scale < 1.08 || scale > 1.42) failures.push(`trash scale out of range: ${scale}`);
  }
  for (const sample of state.powerupSamples || []) {
    const scale = Number(sample.visualScale);
    if (scale < 0.68 || scale > 1.22) failures.push(`powerup scale out of range: ${scale}`);
  }
  for (const sample of state.botSamples || []) {
    const scale = Number(sample.scale);
    if (Number.isFinite(scale) && scale > 0.34) failures.push(`bot boat scale too large: ${scale}`);
  }
  const boat = state.boatFeel || {};
  if (!Number.isFinite(Number(boat.y))) failures.push("missing finite boatFeel.y");
  if (Number(boat.y) < 0.045 || Number(boat.y) > 0.13) failures.push(`boat visual y out of range: ${boat.y}`);
  if (Number.isFinite(Number(boat.waterlineClearance))) {
    const clearance = Number(boat.waterlineClearance);
    if (clearance < 0.035 || clearance > 0.115) failures.push(`boat waterline clearance out of range: ${clearance}`);
  }
  if (state.waterEffects?.wakeRipples !== false || state.waterEffects?.contactRing !== false || state.waterEffects?.engineParticles !== false) {
    failures.push(`expected disabled fake water effects, got ${JSON.stringify(state.waterEffects || {})}`);
  }
  const powerupBadge = state.badges?.powerup || {};
  const statusBadge = state.badges?.status || {};
  if (powerupBadge.visible !== true || statusBadge.visible !== true) {
    failures.push(`expected both badges visible, got ${JSON.stringify(state.badges || {})}`);
  }
  if (powerupBadge.layout !== expectedBadgeLayout.name || statusBadge.layout !== expectedBadgeLayout.name) {
    failures.push(`badge layout mismatch: ${JSON.stringify(state.badges || {})}`);
  }
  if (!approxEqual(powerupBadge.scale, expectedBadgeLayout.powerupScale)) {
    failures.push(`powerup badge scale mismatch: ${powerupBadge.scale}`);
  }
  if (!approxEqual(statusBadge.scale, expectedBadgeLayout.statusScale)) {
    failures.push(`status badge scale mismatch: ${statusBadge.scale}`);
  }
  if (!approxEqual(powerupBadge.y, expectedBadgeLayout.powerupY)) {
    failures.push(`powerup badge y mismatch: ${powerupBadge.y}`);
  }
  if (!approxEqual(statusBadge.y, expectedBadgeLayout.statusY)) {
    failures.push(`status badge y mismatch: ${statusBadge.y}`);
  }
  if (Number(powerupBadge.textWidthRatio || 0) > 0.88) {
    failures.push(`powerup badge text is close to clipping: ${powerupBadge.textWidthRatio}`);
  }
  if (Number(statusBadge.textWidthRatio || 0) > 0.88) {
    failures.push(`status badge text is close to clipping: ${statusBadge.textWidthRatio}`);
  }
}

async function runVisualScenario({ chromium, baseUrl, outputDir, kind, timeoutMs }) {
  const isMobile = kind === "mobile";
  const expectedBadgeLayout = isMobile
    ? { name: "mobile", powerupScale: 0.38, powerupY: 0.74, statusScale: 0.42, statusY: 0.94, minEnvironmentProps: 6 }
    : { name: "desktop", powerupScale: 0.46, powerupY: 0.82, statusScale: 0.5, statusY: 1.04, minEnvironmentProps: 10 };
  const { room, url } = scenarioUrl(baseUrl, isMobile ? "MOBILE" : "DESKTOP");
  const scenarioDir = path.join(outputDir, kind);
  await fs.mkdir(scenarioDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
  });
  const context = await browser.newContext(isMobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForRunning(page, timeoutMs);
    if (!isMobile) {
      await page.keyboard.down("ArrowUp");
      await page.waitForTimeout(650);
      await page.keyboard.down("ArrowLeft");
      await page.waitForTimeout(350);
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.up("ArrowUp");
    }
    await enableBadgeProbe(page);
    await page.waitForTimeout(350);
    const result = await captureState(page);
    await page.screenshot({ path: path.join(scenarioDir, "badges-running.png"), fullPage: true });
    const failures = errors.map((error) => `${error.type}: ${error.text}`);
    validateCommon(result.state, failures, expectedBadgeLayout);
    if (isMobile) {
      const joystick = result.joystick;
      if (!joystick || joystick.display === "none" || joystick.visibility === "hidden") failures.push("mobile joystick hidden");
      if (joystick && (joystick.width < 90 || joystick.height < 90)) {
        failures.push(`mobile joystick too small: ${joystick.width}x${joystick.height}`);
      }
    }
    return {
      name: `${kind}-visual-scale`,
      status: failures.length ? "fail" : "pass",
      failures,
      room,
      url,
      screenshot: path.join(scenarioDir, "badges-running.png"),
      state: result.state,
      joystick: result.joystick,
      canvas: result.canvas,
    };
  } catch (error) {
    await page.screenshot({ path: path.join(scenarioDir, "failure.png"), fullPage: true }).catch(() => {});
    return {
      name: `${kind}-visual-scale`,
      status: "fail",
      room,
      url,
      screenshot: path.join(scenarioDir, "failure.png"),
      error: error.stack || error.message || String(error),
      browser_errors: errors,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runLongHealth({ chromium, baseUrl, outputDir, timeoutMs, durationMs }) {
  const { room, url } = scenarioUrl(baseUrl, "LONG");
  const scenarioDir = path.join(outputDir, "long-health");
  await fs.mkdir(scenarioDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = collectBrowserErrors(page);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForRunning(page, timeoutMs);
    const samples = [];
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
      samples.push(await captureState(page));
      await page.waitForTimeout(5000);
    }
    samples.push(await captureState(page));
    await page.screenshot({ path: path.join(scenarioDir, "final.png"), fullPage: true });
    const states = samples.map((sample) => sample.state);
    await fs.writeFile(path.join(scenarioDir, "samples.json"), JSON.stringify(states, null, 2), "utf8");
    const failures = errors.map((error) => `${error.type}: ${error.text}`);
    const minTrash = Math.min(...states.map((state) => Number(state.trashInstances || 0)));
    const minPowerups = Math.min(...states.map((state) => Number(state.powerupInstances || 0)));
    const minItems = Math.min(...states.map((state) => Number(state.itemsVisible || 0)));
    if (states.some((state) => state.mode !== "RUNNING")) failures.push("long-health state left RUNNING");
    if (minTrash < 4) failures.push(`trash depleted during long-health run: min=${minTrash}`);
    if (minPowerups < 1) failures.push(`powerups depleted during long-health run: min=${minPowerups}`);
    if (minItems < 8) failures.push(`items depleted during long-health run: min=${minItems}`);
    return {
      name: "long-running-item-health",
      status: failures.length ? "fail" : "pass",
      failures,
      room,
      url,
      screenshot: path.join(scenarioDir, "final.png"),
      samples: states.map((state) => ({
        timeRemaining: state.timeRemaining,
        itemsVisible: state.itemsVisible,
        trashInstances: state.trashInstances,
        powerupInstances: state.powerupInstances,
        boatFeel: state.boatFeel,
      })),
    };
  } catch (error) {
    await page.screenshot({ path: path.join(scenarioDir, "failure.png"), fullPage: true }).catch(() => {});
    return {
      name: "long-running-item-health",
      status: "fail",
      room,
      url,
      screenshot: path.join(scenarioDir, "failure.png"),
      error: error.stack || error.message || String(error),
      browser_errors: errors,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function statusIcon(status) {
  return status === "pass" ? "PASS" : "FAIL";
}

function renderMarkdown(report) {
  const lines = [
    "# Save the Wildlife Gameplay Visual QA",
    "",
    `- Generated: ${report.generated_at}`,
    `- Base URL: ${report.base_url}`,
    `- Verdict: ${report.verdict}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`### ${statusIcon(check.status)} ${check.name}`);
    lines.push("");
    if (check.url) lines.push(`- URL: ${check.url}`);
    if (check.screenshot) lines.push(`- Screenshot: ${check.screenshot}`);
    if (check.state) {
      lines.push(`- Mode: ${check.state.mode}`);
      lines.push(`- Items: ${check.state.itemsVisible || 0}, trash ${check.state.trashInstances || 0}, powerups ${check.state.powerupInstances || 0}`);
      lines.push(`- Badges: ${JSON.stringify(check.state.badges || {})}`);
      lines.push(`- Boat feel: ${JSON.stringify(check.state.boatFeel || {})}`);
      lines.push(`- Water effects: ${JSON.stringify(check.state.waterEffects || {})}`);
      lines.push(`- Trash sample scales: ${(check.state.trashSamples || []).map((sample) => sample.visualScale).join(", ") || "-"}`);
      lines.push(`- Powerup sample scales: ${(check.state.powerupSamples || []).map((sample) => sample.visualScale).join(", ") || "-"}`);
    }
    if (check.joystick) {
      lines.push(`- Joystick: ${Math.round(check.joystick.width)}x${Math.round(check.joystick.height)} at ${Math.round(check.joystick.left)},${Math.round(check.joystick.top)}`);
    }
    if (check.samples) {
      const counts = check.samples.map((sample) => `${sample.timeRemaining}s:${sample.trashInstances}/${sample.powerupInstances}/${sample.itemsVisible}`);
      lines.push(`- Samples: ${counts.join(", ")}`);
    }
    if (check.error) lines.push(`- Error: ${String(check.error).split("\n")[0]}`);
    if (check.failures?.length) {
      lines.push("- Failures:");
      for (const failure of check.failures) lines.push(`  - ${failure}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", process.env.STWL_DEMO_BASE_URL || DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", process.env.STWL_GAMEPLAY_VISUAL_QA_OUTPUT_DIR || DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", process.env.STWL_DEMO_TIMEOUT_MS || "90000"));
  const durationMs = Number(argValue("duration-ms", process.env.STWL_GAMEPLAY_VISUAL_QA_DURATION_MS || "45000"));
  await fs.mkdir(outputDir, { recursive: true });
  const playwrightImport = await resolvePlaywrightImport();
  const { chromium } = await import(playwrightImport);
  const checks = [];
  checks.push(await runVisualScenario({ chromium, baseUrl, outputDir, kind: "desktop", timeoutMs }));
  checks.push(await runVisualScenario({ chromium, baseUrl, outputDir, kind: "mobile", timeoutMs }));
  checks.push(await runLongHealth({ chromium, baseUrl, outputDir, timeoutMs, durationMs }));
  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    verdict: checks.some((check) => check.status !== "pass") ? "failed" : "ready",
    checks,
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(path.join(outputDir, "latest.md"), renderMarkdown(report), "utf8");
  console.log(`${report.verdict === "ready" ? "PASS" : "FAIL"} gameplay-visual-qa`);
  console.log(`json=${path.join(outputDir, "latest.json")}`);
  console.log(`summary=${path.join(outputDir, "latest.md")}`);
  if (report.verdict !== "ready") process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
