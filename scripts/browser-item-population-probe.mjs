#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "../web/node_modules/socket.io-client/build/esm/index.js";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_OUTPUT_DIR = path.join(".codex_tmp", "browser-item-population-probe");
const DEFAULT_CLIENTS = [
  { name: "QAItemsChrome", engine: "chrome", scenario: "desktop" },
  { name: "QAItemsWebKit", engine: "webkit", scenario: "desktop" },
  { name: "QAItemsChromeMob", engine: "chrome", scenario: "mobile" },
  { name: "QAItemsWebKitMob", engine: "webkit", scenario: "mobile" },
];

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : fallback;
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

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) resolve({ ok: false, timeout: true, error: error.message || String(error) });
      else resolve(response || { ok: true });
    });
  });
}

async function connectSocket(baseUrl) {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    extraHeaders: { Origin: baseUrl },
    reconnection: false,
    timeout: 10000,
  });
  await new Promise((resolve, reject) => {
    socket.on("connect", resolve);
    socket.on("connect_error", reject);
  });
  return socket;
}

function collectBrowserMessages(page) {
  const errors = [];
  const knownWarnings = [];
  page.on("pageerror", (error) => errors.push({ type: "pageerror", text: error.message || String(error) }));
  page.on("console", (msg) => {
    if (!["error", "warning"].includes(msg.type())) return;
    const text = msg.text();
    const location = typeof msg.location === "function" ? msg.location() : null;
    const locationUrl = String(location?.url || "");
    if (locationUrl.includes("/api/replay/events")) return;
    if (text.includes("/api/replay/events") || text.includes("504")) return;
    if (text.includes("Automatic fallback to software WebGL")) return;
    if (text.includes("GPU stall due to ReadPixels")) return;
    if (text.includes("Audio load failed; continuing without engine sound")) {
      knownWarnings.push({ type: msg.type(), text, location });
      return;
    }
    errors.push({ type: msg.type(), text, location });
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const url = response.url();
    if (url.includes("/api/replay/events")) return;
    errors.push({ type: "http", status: response.status(), url });
  });
  return { errors, knownWarnings };
}

async function installPerfObserver(page) {
  await page.addInitScript(() => {
    window.__stwlQaItemPopulationPerf = { frameDeltas: [], longTasks: [], lastFrameAt: 0 };
    const perf = window.__stwlQaItemPopulationPerf;
    const frame = (ts) => {
      if (perf.lastFrameAt) {
        perf.frameDeltas.push(ts - perf.lastFrameAt);
        if (perf.frameDeltas.length > 3000) perf.frameDeltas.shift();
      }
      perf.lastFrameAt = ts;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          perf.longTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
          if (perf.longTasks.length > 500) perf.longTasks.shift();
        }
      });
      obs.observe({ type: "longtask", buffered: true });
    } catch (_) {}
  });
}

async function readState(page) {
  return page.evaluate(() => {
    const raw = typeof window.render_game_to_text === "function" ? window.render_game_to_text() : null;
    return raw ? JSON.parse(raw) : null;
  });
}

async function readDom(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    };
    return {
      bodyClass: document.body.className,
      compactTime: document.getElementById("compact-time")?.textContent?.trim() || "",
      hudTime: document.getElementById("hud-time")?.textContent?.trim() || "",
      lobbyStatus: document.getElementById("lobby-status")?.textContent?.trim() || "",
      resultsScore: document.getElementById("results-score")?.textContent?.trim() || "",
      joystick: rectFor("#touch-joystick"),
      canvas: rectFor("canvas"),
    };
  });
}

async function readPerf(page) {
  return page.evaluate(() => {
    const perf = window.__stwlQaItemPopulationPerf || {};
    return {
      frameDeltas: perf.frameDeltas || [],
      longTasks: perf.longTasks || [],
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      } : null,
    };
  });
}

async function snapshot(client) {
  const [state, dom] = await Promise.all([
    readState(client.page).catch(() => null),
    readDom(client.page).catch(() => ({})),
  ]);
  return { at: Date.now(), state, dom };
}

async function waitForClient(client, predicate, timeoutMs, intervalMs = 250) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot(client);
    if (predicate(last.state, last.dom)) return { ok: true, elapsedMs: Date.now() - started, ...last };
    await sleep(intervalMs);
  }
  return { ok: false, elapsedMs: Date.now() - started, ...last };
}

function rectVisible(rect) {
  if (!rect) return false;
  if (rect.display === "none" || rect.visibility === "hidden" || Number(rect.opacity) === 0) return false;
  return rect.width > 20 && rect.height > 20;
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarizeNumbers(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  if (!finite.length) return { count: 0 };
  const sum = finite.reduce((acc, value) => acc + value, 0);
  return {
    count: finite.length,
    min: Number(Math.min(...finite).toFixed(2)),
    avg: Number((sum / finite.length).toFixed(2)),
    p95: Number(percentile(finite, 95).toFixed(2)),
    max: Number(Math.max(...finite).toFixed(2)),
  };
}

function parseClients(value) {
  if (!value) return DEFAULT_CLIENTS;
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const [name, engine = idx === 1 ? "webkit" : "chrome", scenario = idx >= 2 ? "mobile" : "desktop"] = entry.split(":");
      return { name, engine, scenario };
    });
}

function itemCounts(state = {}) {
  return {
    itemsVisible: Number(state.itemsVisible ?? state.itemCount ?? 0),
    trash: Number(state.trashInstances ?? state.trashVisible ?? 0),
    powerups: Number(state.powerupInstances ?? state.powerupsVisible ?? 0),
    turtles: Number(state.turtlesTotal ?? state.turtlesRendered ?? state.turtlesVisible ?? state.marineVisible ?? 0),
    trashSamples: Array.isArray(state.trashSamples) ? state.trashSamples.length : 0,
    powerupSamples: Array.isArray(state.powerupSamples) ? state.powerupSamples.length : 0,
    turtleSamples: Array.isArray(state.turtleSamples) ? state.turtleSamples.length : 0,
  };
}

function maxConsecutive(samples, predicate) {
  let best = 0;
  let current = 0;
  for (const sample of samples) {
    if (predicate(sample)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function summarizeItemHealth(samples) {
  const running = samples.filter((sample) => sample.state?.mode === "RUNNING");
  const counts = running.map((sample) => ({ at: sample.at, timeRemaining: sample.state?.timeRemaining, ...itemCounts(sample.state) }));
  const numbers = (key) => counts.map((entry) => entry[key]).filter(Number.isFinite);
  const min = (key) => numbers(key).length ? Math.min(...numbers(key)) : null;
  const max = (key) => numbers(key).length ? Math.max(...numbers(key)) : null;
  const lastResults = running
    .map((sample) => sample.state?.pickups?.lastResult)
    .filter(Boolean);
  const notRunningResults = lastResults.filter((entry) => entry?.error === "not_running");
  return {
    runningSamples: running.length,
    min: {
      itemsVisible: min("itemsVisible"),
      trash: min("trash"),
      powerups: min("powerups"),
      turtles: min("turtles"),
    },
    max: {
      itemsVisible: max("itemsVisible"),
      trash: max("trash"),
      powerups: max("powerups"),
      turtles: max("turtles"),
    },
    lowTrashStreak: maxConsecutive(counts, (entry) => Number(entry.trash) < 5),
    lowPowerupStreak: maxConsecutive(counts, (entry) => Number(entry.powerups) < 1),
    turtleDominanceStreak: maxConsecutive(counts, (entry) => Number(entry.turtles) > 0 && Number(entry.trash) === 0),
    notRunningCollisionResults: notRunningResults.length,
    latestCollisionResult: lastResults.at(-1) || null,
    timeline: counts.map((entry) => ({
      at: entry.at,
      timeRemaining: entry.timeRemaining,
      itemsVisible: entry.itemsVisible,
      trash: entry.trash,
      powerups: entry.powerups,
      turtles: entry.turtles,
      trashSamples: entry.trashSamples,
      powerupSamples: entry.powerupSamples,
      turtleSamples: entry.turtleSamples,
    })),
  };
}

async function driveDesktop(client, stop) {
  await client.page.click("canvas", { timeout: 5000 }).catch(() => {});
  const keys = new Set();
  const down = async (key) => {
    if (keys.has(key)) return;
    keys.add(key);
    await client.page.keyboard.down(key).catch(() => {});
  };
  const up = async (key) => {
    if (!keys.has(key)) return;
    keys.delete(key);
    await client.page.keyboard.up(key).catch(() => {});
  };
  try {
    await down("ArrowUp");
    let turnRight = true;
    while (!stop.stopped) {
      await down(turnRight ? "KeyD" : "KeyA");
      await up(turnRight ? "KeyA" : "KeyD");
      turnRight = !turnRight;
      await sleep(2800);
    }
  } finally {
    await Promise.all([...keys].map((key) => up(key)));
  }
}

async function driveMobile(client, stop) {
  let direction = 1;
  while (!stop.stopped) {
    const dom = await readDom(client.page).catch(() => ({}));
    if (!rectVisible(dom.joystick)) {
      await sleep(1000);
      continue;
    }
    const startX = dom.joystick.left + dom.joystick.width / 2;
    const startY = dom.joystick.top + dom.joystick.height / 2;
    const endX = startX + dom.joystick.width * 0.25 * direction;
    const endY = startY - dom.joystick.height * 0.38;
    await client.page.mouse.move(startX, startY).catch(() => {});
    await client.page.mouse.down().catch(() => {});
    await client.page.mouse.move(endX, endY, { steps: 10 }).catch(() => {});
    await sleep(2500);
    await client.page.mouse.up().catch(() => {});
    direction *= -1;
    await sleep(300);
  }
}

async function openClient({ playwright, clientSpec, baseUrl, room, outputDir, timeoutMs }) {
  const browserType = clientSpec.engine === "chrome" ? playwright.chromium : playwright[clientSpec.engine];
  if (!browserType) throw new Error(`Missing Playwright engine: ${clientSpec.engine}`);
  const browser = await browserType.launch({
    headless: true,
    channel: clientSpec.engine === "chrome" ? "chrome" : undefined,
  });
  const context = await browser.newContext(clientSpec.scenario === "mobile"
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await installPerfObserver(page);
  const messages = collectBrowserMessages(page);
  const url = `${baseUrl}/?name=${encodeURIComponent(clientSpec.name)}&room=${encodeURIComponent(room)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: timeoutMs });
  await page.screenshot({ path: path.join(outputDir, `${clientSpec.name}-initial.png`), fullPage: true }).catch(() => {});
  return { ...clientSpec, browser, context, page, url, samples: [], midShotTaken: false, ...messages };
}

async function main() {
  const baseUrl = normalizeBaseUrl(argValue("base-url", DEFAULT_BASE_URL));
  const outputDir = argValue("output-dir", DEFAULT_OUTPUT_DIR);
  const timeoutMs = Number(argValue("timeout-ms", "180000"));
  const sampleMs = Number(argValue("sample-ms", "70000"));
  const room = argValue("room", `QA-ITEMS-${Date.now().toString().slice(-6)}`);
  const clientsSpec = parseClients(argValue("clients", "")).slice(0, 4);
  const startedAt = new Date().toISOString();
  const checks = [];
  const clients = [];
  const socketEvents = [];
  const stop = { stopped: false };
  let adminSocket = null;
  let startAck = null;
  let endAck = null;

  await fs.mkdir(outputDir, { recursive: true });

  try {
    const playwright = await import(await resolvePlaywrightImport());
    for (const clientSpec of clientsSpec) {
      clients.push(await openClient({ playwright, clientSpec, baseUrl, room, outputDir, timeoutMs }));
      const lobby = await waitForClient(clients.at(-1), (state, dom) => state && state.mode !== "RUNNING" && dom.bodyClass.includes("phase-lobby"), 45000);
      clients.at(-1).lobby = lobby;
      checks.push({
        name: `${clientSpec.name} waits in lobby before admin start`,
        status: lobby.ok ? "pass" : "fail",
        mode: lobby.state?.mode,
        bodyClass: lobby.dom?.bodyClass,
      });
    }

    adminSocket = await connectSocket(baseUrl);
    adminSocket.onAny((event, payload) => {
      if (/^(game|items?|item|room)\./.test(event) || event === "startingGame") {
        socketEvents.push({ at: Date.now(), event, payload });
        if (socketEvents.length > 500) socketEvents.shift();
      }
    });
    startAck = await emitAck(adminSocket, "admin.presenter.start", { room }, 8000);
    checks.push({ name: "admin presenter start accepted", status: startAck?.ok === true ? "pass" : "fail", ack: startAck });

    const runningResults = await Promise.all(clients.map(async (client) => ({
      client,
      running: await waitForClient(client, (state, dom) => {
        if (state?.mode !== "RUNNING" || !dom.bodyClass.includes("phase-gameplay")) return false;
        const counts = itemCounts(state);
        return counts.trash >= 5 && counts.powerups >= 1 && counts.turtles >= 1;
      }, 45000),
    })));
    for (const { client, running } of runningResults) {
      client.running = running;
      client.runningAt = running.ok ? running.at : null;
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-running.png`), fullPage: true }).catch(() => {});
      const counts = itemCounts(running.state);
      checks.push({
        name: `${client.name} reaches running with items`,
        status: running.ok && counts.trash >= 5 && counts.powerups >= 1 && counts.turtles >= 1 ? "pass" : "fail",
        elapsedMs: running.elapsedMs,
        timeRemaining: running.state?.timeRemaining,
        counts,
      });
      if (client.scenario === "mobile") {
        checks.push({
          name: `${client.name} mobile joystick visible`,
          status: rectVisible(running.dom?.joystick) ? "pass" : "fail",
          joystick: running.dom?.joystick || null,
        });
      }
    }

    const driveTasks = clients.map((client) => (
      client.scenario === "mobile" ? driveMobile(client, stop) : driveDesktop(client, stop)
    ).catch((error) => {
      client.errors.push({ type: "drive", text: error.message || String(error) });
    }));

    const observeStartedAt = Date.now();
    const deadline = observeStartedAt + sampleMs;
    while (Date.now() < deadline) {
      for (const client of clients) {
        const sample = await snapshot(client).catch(() => null);
        if (!sample) continue;
        client.samples.push(sample);
        if (!client.midShotTaken && Date.now() - observeStartedAt > sampleMs / 2) {
          client.midShotTaken = true;
          await client.page.screenshot({ path: path.join(outputDir, `${client.name}-midmatch.png`), fullPage: true }).catch(() => {});
        }
        if (!client.postGameAt && (sample.dom?.bodyClass || "").includes("phase-post_game")) client.postGameAt = sample.at;
        if (!client.endedAt && sample.state?.mode === "ENDED") client.endedAt = sample.at;
      }
      if (clients.every((client) => client.postGameAt || client.endedAt)) break;
      await sleep(1000);
    }

    stop.stopped = true;
    await Promise.allSettled(driveTasks);

    for (const client of clients) {
      await client.page.screenshot({ path: path.join(outputDir, `${client.name}-final.png`), fullPage: true }).catch(() => {});
      client.final = await snapshot(client).catch(() => null);
      client.perf = await readPerf(client.page).catch(() => ({}));
      client.health = summarizeItemHealth(client.samples);
      const frameDeltas = summarizeNumbers(client.perf?.frameDeltas || []);
      checks.push({
        name: `${client.name} item population remains healthy during match`,
        status: client.health.runningSamples >= 20
          && Number(client.health.min.trash) >= 5
          && Number(client.health.min.powerups) >= 1
          && Number(client.health.min.turtles) >= 1
          && client.health.lowTrashStreak < 5
          && client.health.lowPowerupStreak < 5
          && client.health.turtleDominanceStreak === 0
          ? "pass"
          : "fail",
        health: client.health,
      });
      checks.push({
        name: `${client.name} no lifecycle collision rejection appears during item-health drive`,
        status: client.health.notRunningCollisionResults === 0 ? "pass" : "fail",
        notRunningCollisionResults: client.health.notRunningCollisionResults,
        latestCollisionResult: client.health.latestCollisionResult,
      });
      checks.push({
        name: `${client.name} frame budget remains healthy during item-health drive`,
        status: Number(client.final?.state?.frame?.fps || 0) >= 45 && Number(frameDeltas.p95 || 0) <= 40 ? "pass" : "fail",
        finalFrame: client.final?.state?.frame || null,
        rafP95: frameDeltas.p95,
        longTasks: client.perf?.longTasks?.length || 0,
        memory: client.perf?.memory || null,
      });
      checks.push({
        name: `${client.name} browser errors`,
        status: client.errors.length === 0 ? "pass" : "fail",
        errors: client.errors,
        knownWarnings: client.knownWarnings,
      });
    }

    endAck = await emitAck(adminSocket, "admin.presenter.end", { room }, 8000);
    const alreadyEnded = endAck?.ok === false && endAck?.error === "invalid_state" && endAck?.state === "ENDED";
    checks.push({
      name: "admin presenter end accepted or room already naturally ended",
      status: endAck?.ok === true || alreadyEnded ? "pass" : "fail",
      ack: endAck,
    });
  } catch (error) {
    checks.push({ name: "probe fatal error", status: "fail", error: error?.stack || error?.message || String(error) });
  } finally {
    stop.stopped = true;
    try { if (adminSocket) adminSocket.disconnect(); } catch (_) {}
    for (const client of clients) {
      try { await client.browser.close(); } catch (_) {}
    }
  }

  const result = {
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    room,
    sampleMs,
    clients: clientsSpec,
    startAck,
    endAck,
    checks,
    socketEvents,
    clientSummaries: clients.map((client) => ({
      name: client.name,
      engine: client.engine,
      scenario: client.scenario,
      url: client.url,
      lobby: client.lobby ? {
        ok: client.lobby.ok,
        mode: client.lobby.state?.mode,
        bodyClass: client.lobby.dom?.bodyClass,
      } : null,
      running: client.running ? {
        ok: client.running.ok,
        at: client.running.at,
        timeRemaining: client.running.state?.timeRemaining,
        mode: client.running.state?.mode,
        counts: itemCounts(client.running.state),
      } : null,
      postGameAt: client.postGameAt || null,
      endedAt: client.endedAt || null,
      final: client.final,
      health: client.health || null,
      sampleCount: client.samples.length,
      samples: client.samples.map((sample) => ({
        at: sample.at,
        mode: sample.state?.mode || null,
        timeRemaining: sample.state?.timeRemaining ?? null,
        counts: itemCounts(sample.state || {}),
        player: sample.state?.player || null,
        pickup: sample.state?.pickups?.lastResult || null,
        frame: sample.state?.frame || null,
        bodyClass: sample.dom?.bodyClass || "",
        compactTime: sample.dom?.compactTime || "",
      })),
      perf: client.perf ? {
        rafMs: summarizeNumbers(client.perf.frameDeltas || []),
        longTasks: client.perf.longTasks?.length || 0,
        memory: client.perf.memory || null,
      } : null,
      errors: client.errors,
      knownWarnings: client.knownWarnings,
    })),
  };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(result, null, 2)}\n`);

  const lines = [
    "# Browser Item Population Probe",
    "",
    `- Status: ${statusIcon(result.status)}`,
    `- Base URL: \`${baseUrl}\``,
    `- Room: \`${room}\``,
    `- Sample window: ${sampleMs}ms`,
    `- Clients: ${clientsSpec.map((client) => `\`${client.name}:${client.engine}:${client.scenario}\``).join(", ")}`,
    "",
    "## Checks",
  ];
  for (const check of checks) {
    if (check.health) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; min trash/powerups/turtles=${check.health.min.trash}/${check.health.min.powerups}/${check.health.min.turtles}; not_running=${check.health.notRunningCollisionResults}`);
    } else if (check.counts) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; counts trash/powerups/turtles=${check.counts.trash}/${check.counts.powerups}/${check.counts.turtles}`);
    } else if (check.notRunningCollisionResults != null) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; not_running=${check.notRunningCollisionResults}`);
    } else if (check.finalFrame) {
      lines.push(`- ${statusIcon(check.status)} ${check.name}; fps=${check.finalFrame.fps}; rafP95=${check.rafP95}ms`);
    } else {
      lines.push(`- ${statusIcon(check.status)} ${check.name}`);
    }
  }
  lines.push("", "## Item Timelines");
  for (const client of result.clientSummaries) {
    const timeline = client.health?.timeline || [];
    const sparse = timeline.filter((_, idx) => idx % 5 === 0 || idx === timeline.length - 1);
    lines.push(`- ${client.name}: ${sparse.map((entry) => `${entry.timeRemaining}s:${entry.trash}/${entry.powerups}/${entry.turtles}`).join(" ")}`);
  }
  await fs.writeFile(path.join(outputDir, "latest.md"), `${lines.join("\n")}\n`);
  if (result.status !== "pass") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
