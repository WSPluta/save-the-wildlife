import fs from "node:fs";
import { chromium } from "/Users/wojtekpluta/.codex/skills/develop-web-game/node_modules/playwright/index.mjs";

const baseUrl = process.env.BASE_URL || "http://localhost:8080";
const room = `MOBILE-${Date.now().toString().slice(-6)}`;
const url = `${baseUrl.replace(/\/$/, "")}/?name=MobilePolish&room=${room}&autostart=1`;
const outDir = "output/mobile-polish-smoke";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message }));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  const text = msg.text();
  if (text.includes("/api/replay/events") || text.includes("504")) return;
  errors.push({ type: "console.error", text });
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: 120000 });
  await page.waitForFunction(() => {
    try {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === "RUNNING";
    } catch {
      return false;
    }
  }, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
} catch (error) {
  await page.screenshot({ path: `${outDir}/mobile-failure.png`, fullPage: true }).catch(() => {});
  fs.writeFileSync(`${outDir}/failure.json`, JSON.stringify({ url, room, error: error.message, errors }, null, 2));
  throw error;
}

const result = await page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  const joystick = document.getElementById("touch-joystick");
  const style = joystick ? getComputedStyle(joystick) : null;
  const rect = joystick ? joystick.getBoundingClientRect() : null;
  return {
    state,
    bodyClass: document.body.className,
    joystick: joystick && style && rect ? {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    } : null,
  };
});

await page.screenshot({ path: `${outDir}/mobile-running.png`, fullPage: true });
fs.writeFileSync(`${outDir}/result.json`, JSON.stringify({ url, room, result, errors }, null, 2));
await browser.close();

if (errors.length) {
  console.error(JSON.stringify(errors, null, 2));
  process.exit(1);
}
if (result.state.mode !== "RUNNING") {
  throw new Error(`expected RUNNING, got ${result.state.mode}`);
}
if (!result.joystick || result.joystick.display === "none" || result.joystick.width < 40 || result.joystick.height < 40) {
  throw new Error("touch joystick was not visible at mobile viewport");
}
console.log(JSON.stringify({ ok: true, room, state: result.state, joystick: result.joystick }, null, 2));
