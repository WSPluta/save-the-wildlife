import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("src/index.html", "utf8");
const script = readFileSync("src/script.js", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const worker = readFileSync("src/commsWorker.js", "utf8");
const lobby = readFileSync("src/lobby.js", "utf8");
const server = readFileSync("../server/server.js", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const nginx = readFileSync("nginx.conf", "utf8");
const ingress = readFileSync("../deploy/k8s/base/ingress/ingress.yaml", "utf8");

describe("presenter-controlled lobby flow", () => {
  it("keeps the player lobby waiting-only with a visible roster", () => {
    expect(html).toContain('id="screen-lobby"');
    expect(html).not.toContain('id="btn-lobby-start"');
    expect(html).toContain('class="lobby-wait-pill"');
    expect(html).toMatch(/<details class="lobby-detail" open>\s*<summary>Players<\/summary>/);
    expect(html).toContain('id="waiting-list"');
  });

  it("provides an /admin presenter console", () => {
    expect(html).toContain('id="screen-admin"');
    expect(html).toContain('id="btn-admin-start"');
    expect(html).toContain('id="btn-admin-end"');
    expect(html).toContain('id="admin-player-list"');
    expect(script).toMatch(/path === "\/admin" \|\| isAiLearningAdminPath\(path\) \|\| path === "\/admin\/observability"/);
    expect(script).toMatch(/ADMIN:\s*"ADMIN"/);
    expect(script).toMatch(/if \(!IS_ADMIN_VIEW && !clientGameStarted\)/);
    expect(styles).toMatch(/body\.phase-admin #hud/);
  });

  it("keeps player HUD clean and clears stale debug mode outside explicit debug URLs", () => {
    expect(styles).toMatch(/body:not\(\.admin-view\) \.lifecycle-admin-control/);
    expect(styles).toMatch(/body:not\(\.admin-view\) #btn-toggle-debug/);
    expect(styles).toMatch(/body:not\(\.admin-view\):not\(\.debug-view\) #hud/);
    expect(styles).toMatch(/body\.admin-view #hud-compact/);
    expect(script).toMatch(/if \(!IS_ADMIN_VIEW && !urlDebug\) \{/);
    expect(script).toMatch(/localStorage\.setItem\("debugHUD", "0"\)/);
    expect(script).toMatch(/document\.body\.classList\.toggle\("debug-view", debugOn\)/);
    expect(script).toMatch(/full\.style\.display = \(IS_ADMIN_VIEW \|\| debugOn\) \? "flex" : "none"/);
  });

  it("routes players from name entry directly into the waiting lobby", () => {
    expect(script).toMatch(/accessContinueBtn\.addEventListener\("click", async \(\) =>/);
    expect(script).toMatch(/await enterWaitingLobby\(\)/);
    expect(script).toMatch(/setPhase\("LOBBY"\)/);
    expect(script).toMatch(/Game renderer init failed while entering lobby; keeping lobby visible/);
    const enterLobby = script.slice(script.indexOf("async function enterWaitingLobby"), script.indexOf("async function enterAdminConsole"));
    expect(enterLobby.indexOf('setPhase("LOBBY")')).toBeLessThan(enterLobby.indexOf("await init()"));
    expect(script).toMatch(/if \(!IS_ADMIN_VIEW\)\s*{\s*try\s*{\s*postWorkerMessage\(\{\s*type: "player\.info\.joining"/);
  });

  it("keeps player names out of invite URLs and syncs canonical session identity", () => {
    expect(lobby).toMatch(/Player names are server\/session state, not URL state/);
    expect(lobby).not.toMatch(/params\.set\("name"/);
    expect(script).toMatch(/const CLIENT_SESSION_STORAGE_KEY = "stwlClientSessionId"/);
    expect(script).toMatch(/function stripNameParamFromUrl\(\)/);
    expect(script).toMatch(/url\.searchParams\.delete\("name"\)/);
    expect(script).toMatch(/nameParam && nameParam\.trim\(\) && !localStorage\.getItem\("yourName"\)/);
    expect(script).toMatch(/clientSessionId,/);
    expect(worker).toMatch(/clientSessionId/);
    expect(worker).toMatch(/socket\.on\("player\.session"/);
    expect(server).toMatch(/socket\.emit\("player\.session", profile\)/);
  });

  it("uses canonical profile room/name data for scaled websocket rosters", () => {
    expect(server).toMatch(/await readCacheEntries\(mapPlayersInfo\)/);
    expect(server).toMatch(/const profileRoom = v && v\.room \? normalizeRoom\(v\.room\) : null;/);
    expect(server).toMatch(/const profileRoom = value && value\.room \? normalizeRoom\(value\.room\) : null;/);
    expect(server).toMatch(/playerName: canonicalPlayerName,/);
    expect(server).toMatch(/function isBotProfile\(profile = \{\}, id = ""\)/);
    expect(server).toMatch(/function countHumansAndBots\(playersInfo = \{\}\)/);
    expect(server).toMatch(/const \{ humans: humansGlobal \} = countHumansAndBots\(info\)/);
  });

  it("uses presenter socket commands instead of player admin claim for /admin start", () => {
    expect(script).toMatch(/type: "admin\.presenter\.start"/);
    expect(script).toMatch(/type: "admin\.presenter\.end"/);
    expect(worker).toMatch(/case "admin\.presenter\.start":/);
    expect(worker).toMatch(/emitWithAck\("admin\.presenter\.start"/);
    expect(worker).toMatch(/case "admin\.presenter\.end":/);
    expect(worker).toMatch(/emitWithAck\("admin\.presenter\.end"/);
    expect(worker).toMatch(/isPresenter/);
    expect(worker).toMatch(/if \(!isPresenter\) \{\s*socket\.emit\("player\.info\.joining"/);
    expect(server).toMatch(/socket\.on\("admin\.presenter\.start"/);
    expect(server).toMatch(/socket\.on\("admin\.presenter\.end"/);
    expect(server).toMatch(/DEMO_ADMIN_TOKEN/);
  });

  it("preserves waiting-room roster entries when stale gameplay traces age out", () => {
    expect(server).toMatch(/const roomState = roomTimers\.get\(room\)\?\.state \|\| gameState \|\| "WAITING"/);
    expect(server).toMatch(/if \(roomState !== "RUNNING"\)\s*{[\s\S]*deleteCache\(mapPlayersTraces, p\.id\)[\s\S]*continue;/);
  });

  it("serves the SPA for clean /admin URLs in dev and nginx", () => {
    const webpackCommon = readFileSync("bundler/webpack.common.js", "utf8");
    const webpackDev = readFileSync("bundler/webpack.dev.js", "utf8");
    expect(webpackCommon).toMatch(/publicPath:\s*['"]\/['"]/);
    expect(webpackDev).toMatch(/historyApiFallback:\s*true/);
    expect(webpackDev).toMatch(/context:\s*\["\/metrics"\][\s\S]*target:\s*`http:\/\/localhost:\$\{WS_PORT\}`/);
    expect(dockerfile).toMatch(/COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
    expect(nginx).toMatch(/try_files \$uri \$uri\/ \/index\.html;/);
    expect(nginx).toMatch(/Cache-Control "no-store, max-age=0" always/);
  });

  it("serves stale nested admin asset URLs as real root assets instead of the SPA shell", () => {
    expect(nginx).toMatch(/location ~ \^\/admin\/\(\.\+\\\.\(\?:css\|js\|map/);
    expect(nginx).toMatch(/try_files \/\$1 =404;/);
  });

  it("routes public Prometheus metrics to ws-server instead of the SPA", () => {
    expect(ingress).toMatch(/path:\s*\/metrics[\s\S]*pathType:\s*Exact[\s\S]*name:\s*ws-server[\s\S]*number:\s*3000/);
  });

  it("broadcasts commentary to the room so presenter admin can list lines per player", () => {
    expect(server).toMatch(/const roomCommentaryHistory = new Map\(\);/);
    expect(server).toMatch(/const pendingCommentaryTasks = new Map\(\);/);
    expect(server).toMatch(/function rememberRoomCommentary\(room, payload = \{\}\)/);
    expect(server).toMatch(/function queueGameOverCommentary\(io, \{ room, event, playerName \} = \{\}\)/);
    expect(server).toMatch(/io\.to\(safeRoom\)\.emit\("commentary\.pending", pendingPayload\)/);
    expect(server).toMatch(/runAsyncTask\(`commentary\.\$\{key\}`/);
    expect(server).toMatch(/socket\.emit\("commentary\.history", commentaryHistoryForRoom\(wanted\)\)/);
    expect(server).toMatch(/io\.to\(safeRoom\)\.emit\("commentary\.ready", commentaryPayload\)/);
    expect(worker).toMatch(/socket\.on\("commentary\.pending"/);
    expect(worker).toMatch(/commentary\.commentary \|\| commentary\.text \|\| commentary\.script/);
    expect(worker).toMatch(/postMessage\(\{ type: "commentary\.pending", body: commentary \}\)/);
    expect(script).toMatch(/case "commentary\.pending":/);
    expect(script).toMatch(/case "commentary\.history":/);
    expect(script).toMatch(/rememberAdminCommentaryHistory\(body \|\| \[\]\)/);
    expect(script).toMatch(/function applyLatestResultsCommentaryFromHistory\(entries = \[\]\)/);
    expect(script).toMatch(/function applyResultsCommentaryPayload\(payload = \{\}, \{ pending = false \} = \{\}\)/);
  });

  it("keeps the result card visible while slow live commentary finishes", () => {
    expect(script).toMatch(/if \(incomingState === "WAITING"\) \{[\s\S]*stopLocalTimeTicker\(\);[\s\S]*if \(currentPhase === "POST_GAME"\) \{[\s\S]*break;[\s\S]*\}[\s\S]*setPhase\("LOBBY"\);/);
    expect(script).toMatch(/case "commentary\.ready":[\s\S]*applyResultsCommentaryPayload\(body \|\| \{\}\);/);
    expect(script).toMatch(/case "commentary\.pending":[\s\S]*applyResultsCommentaryPayload\(body \|\| \{\}, \{ pending: true \}\);/);
  });
});
