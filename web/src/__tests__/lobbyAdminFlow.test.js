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
    expect(script).toMatch(/path === "\/admin" \|\| path === "\/admin\/ai-learning" \|\| path === "\/admin\/observability"/);
    expect(script).toMatch(/ADMIN:\s*"ADMIN"/);
    expect(script).toMatch(/if \(!IS_ADMIN_VIEW && !clientGameStarted\)/);
    expect(styles).toMatch(/body\.phase-admin #hud/);
  });

  it("routes players from name entry directly into the waiting lobby", () => {
    expect(script).toMatch(/accessContinueBtn\.addEventListener\("click", async \(\) =>/);
    expect(script).toMatch(/await enterWaitingLobby\(\)/);
    expect(script).toMatch(/setPhase\("LOBBY"\)/);
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
    expect(dockerfile).toMatch(/COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
    expect(nginx).toMatch(/try_files \$uri \$uri\/ \/index\.html;/);
    expect(nginx).toMatch(/Cache-Control "no-store, max-age=0" always/);
  });
});
