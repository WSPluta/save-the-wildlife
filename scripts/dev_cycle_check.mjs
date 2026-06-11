import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();
const OUTPUT_ROOT = path.join(REPO_ROOT, "output", "dev-cycle");
const WEB_GAME_URL = "http://localhost:8080";
const RUNNING_SCENARIO_URL = `${WEB_GAME_URL}/?name=DevCycleRunner&room=ROOM-0001&autostart=1`;
const ENDED_SCENARIO_URL = `${WEB_GAME_URL}/?name=DevCycleEnder&room=ROOM-0002&autostart=1`;
const CODEX_HOME = process.env.CODEX_HOME || `${process.env.HOME}/.codex`;
const WEB_GAME_CLIENT = path.join(
  CODEX_HOME,
  "skills",
  "develop-web-game",
  "scripts",
  "web_game_playwright_client.js"
);

const report = {
  startedAt: new Date().toISOString(),
  checks: [],
};

function pushCheck(name, ok, details = "") {
  report.checks.push({ name, ok, details });
}

function assertOrThrow(condition, message) {
  if (!condition) throw new Error(message);
}

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || REPO_ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: opts.stdio || "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function startBackground(cmd, args = [], opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: "inherit",
  });
  return child;
}

async function waitForHttp(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {
      // keep retrying
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function writeActions(filePath, steps) {
  await fs.writeFile(filePath, JSON.stringify({ steps }, null, 2), "utf8");
}

async function readState(dir, idx = 0) {
  const statePath = path.join(dir, `state-${idx}.json`);
  const raw = await fs.readFile(statePath, "utf8");
  return JSON.parse(raw);
}

async function checkFilesExist(files) {
  for (const f of files) {
    await fs.access(path.join(REPO_ROOT, f));
  }
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureNodeDeps(serviceDir, requiredBins = []) {
  const pkgPath = path.join(REPO_ROOT, serviceDir, "package.json");
  const hasPackage = await pathExists(pkgPath);
  if (!hasPackage) return;
  const modulesDir = path.join(REPO_ROOT, serviceDir, "node_modules");
  const hasModules = await pathExists(modulesDir);
  let missingBin = false;
  for (const bin of requiredBins) {
    const p = path.join(REPO_ROOT, serviceDir, "node_modules", ".bin", bin);
    if (!(await pathExists(p))) {
      missingBin = true;
      break;
    }
  }
  if (!hasModules || missingBin) {
    await run("npm", ["--prefix", serviceDir, "install"]);
  }
}

async function runPlaywrightScenario({
  name,
  url = WEB_GAME_URL,
  steps,
  iterations = 1,
  pauseMs = 250,
}) {
  const outDir = path.join(OUTPUT_ROOT, name);
  await ensureCleanDir(outDir);
  const actionsFile = path.join(outDir, "actions.json");
  await writeActions(actionsFile, steps);
  await run("node", [
    WEB_GAME_CLIENT,
    "--url",
    url,
    "--actions-file",
    actionsFile,
    "--iterations",
    String(iterations),
    "--pause-ms",
    String(pauseMs),
    "--screenshot-dir",
    outDir,
  ]);
  return outDir;
}

async function emitAdminCommand(eventName) {
  const socketIOModuleUrl = pathToFileURL(
    path.join(REPO_ROOT, "web", "node_modules", "socket.io-client", "build", "esm", "index.js")
  ).href;
  const { io } = await import(socketIOModuleUrl);
  const socket = io("http://localhost:3000", {
    transports: ["websocket", "polling"],
    withCredentials: false,
  });
  const adminId = `dev-cycle-admin-${Date.now()}`;

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("admin socket connect timeout")), 5000);
      socket.on("connect", () => {
        clearTimeout(t);
        resolve();
      });
      socket.on("connect_error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    socket.emit("player.info.joining", {
      id: adminId,
      name: "DevCycle Admin",
      room: "ROOM-0001",
    });
    socket.emit("room.join", { id: "ROOM-0001" });
    socket.emit("admin.claim");
    await new Promise((r) => setTimeout(r, 200));
    const ack = await new Promise((resolve) => {
      socket.timeout(2000).emit(eventName, { cmdId: `dc-${Date.now()}` }, (err, res) => {
        resolve({ err, res });
      });
    });
    if (ack.err) throw ack.err;
    if (
      ack.res &&
      ack.res.ok === false &&
      ack.res.error !== "invalid_state" &&
      ack.res.error !== "not_admin"
    ) {
      throw new Error(`admin ${eventName} failed: ${ack.res.error}`);
    }
  } finally {
    try { socket.close(); } catch (_) {}
  }
}

async function main() {
  await ensureCleanDir(OUTPUT_ROOT);

  await ensureNodeDeps("server", ["vitest"]);
  await ensureNodeDeps("web", ["vitest"]);

  // Local quality gates
  await run("npm", ["--prefix", "server", "run", "test:unit"]);
  pushCheck("server-unit-tests", true);

  await run("npm", ["--prefix", "web", "run", "test:unit"]);
  pushCheck("web-unit-tests", true);

  await run("node", ["--check", "bots/index.js"]);
  await run("node", ["--check", "server/server.js"]);
  pushCheck("syntax-checks", true, "bots/server syntax ok");

  // Prod deploy docs readiness (oci-devops-prod-deploy skill)
  const prodDocs = [
    "livelabs/safethewildlife/devops/repo/repo.md",
    "livelabs/safethewildlife/devops/infra1/infra1.md",
    "livelabs/safethewildlife/devops/infra2/infra2.md",
    "livelabs/safethewildlife/devops/buildpipeline/buildpipeline.md",
    "livelabs/safethewildlife/devops/deploy/deploy.md",
    "livelabs/safethewildlife/devops/rollback/rollback.md",
  ];
  await checkFilesExist(prodDocs);
  await checkFilesExist([
    "deploy/devops/tf-env/variables.tf",
    "deploy/devops/tf-env/provider.tf",
    "deploy/devops/tf-devops/variables.tf",
    "deploy/devops/tf-devops/provider.tf",
  ]);
  pushCheck("oci-prod-deploy-readiness", true, "docs and terraform roots found");

  // oracle-db-skills-main readiness checks
  await checkFilesExist([
    "oracle-db-skills-main/README.md",
    "oracle-db-skills-main/SKILLS.md",
    "oracle-db-skills-main/skills-index.md",
    "oracle-db-skills-main/SKILL.md",
  ]);
  const allSkillFiles = (
    await fs.readdir(path.join(REPO_ROOT, "oracle-db-skills-main", "skills"), {
      recursive: true,
      withFileTypes: true,
    })
  ).filter((d) => d.isFile() && d.name.endsWith(".md"));
  assertOrThrow(allSkillFiles.length >= 80, "oracle-db-skills-main has too few markdown skills");
  pushCheck("oracle-db-skills-main-readiness", true, `${allSkillFiles.length} markdown skills found`);

  // Runtime lifecycle checks (develop-web-game skill loop)
  let serverProc = null;
  let webProc = null;
  try {
    serverProc = startBackground("node", ["index.js"], {
      cwd: path.join(REPO_ROOT, "server"),
      env: {
        ENABLE_COHERENCE_BACKEND: "false",
        REALTIME_CLUSTER_BACKEND: "memory",
        GAME_DURATION_IN_SECONDS: "8",
      },
    });
    webProc = startBackground("npm", ["run", "dev"], {
      cwd: path.join(REPO_ROOT, "web"),
    });

    await waitForHttp(WEB_GAME_URL, 180000);
    pushCheck("dev-servers-up", true);

    const runDir = await runPlaywrightScenario({
      name: "lifecycle-running",
      url: RUNNING_SCENARIO_URL,
      steps: [
        { buttons: [], frames: 5 },
      ],
      iterations: 1,
      pauseMs: 1500,
    });
    const runState = await readState(runDir, 0);
    assertOrThrow(
      runState.mode === "RUNNING" || runState.mode === "STARTING",
      `expected RUNNING/STARTING, got ${runState.mode}`
    );
    assertOrThrow((runState.itemsVisible || 0) > 0, "expected visible items in RUNNING");
    pushCheck("lifecycle-running", true, JSON.stringify(runState));

    const endDir = await runPlaywrightScenario({
      name: "lifecycle-ended-waiting",
      url: ENDED_SCENARIO_URL,
      steps: [
        { buttons: [], frames: 5 },
      ],
      iterations: 1,
      pauseMs: 19500,
    });
    const endState = await readState(endDir, 0);
    assertOrThrow(
      endState.mode === "WAITING" || endState.mode === "ENDED",
      `expected WAITING/ENDED after short match, got ${endState.mode}`
    );
    if (endState.mode === "WAITING") {
      assertOrThrow(endState.timeRemaining === 8, `expected waiting timeRemaining 8, got ${endState.timeRemaining}`);
    }
    pushCheck("lifecycle-ended-waiting", true, JSON.stringify(endState));
  } finally {
    if (webProc && !webProc.killed) webProc.kill("SIGINT");
    if (serverProc && !serverProc.killed) serverProc.kill("SIGINT");
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.checks.every((c) => c.ok);
  await fs.writeFile(
    path.join(OUTPUT_ROOT, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  console.log(`Dev cycle report written to ${path.join(OUTPUT_ROOT, "report.json")}`);
}

main().catch(async (err) => {
  report.finishedAt = new Date().toISOString();
  report.ok = false;
  report.error = err && err.message ? err.message : String(err);
  try {
    await fs.mkdir(OUTPUT_ROOT, { recursive: true });
    await fs.writeFile(
      path.join(OUTPUT_ROOT, "report.json"),
      JSON.stringify(report, null, 2),
      "utf8"
    );
  } catch (_) {
    // ignore
  }
  console.error(err);
  process.exit(1);
});
