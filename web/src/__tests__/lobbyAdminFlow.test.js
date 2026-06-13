import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("src/index.html", "utf8");
const script = readFileSync("src/script.js", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const worker = readFileSync("src/commsWorker.js", "utf8");
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
    expect(script).toMatch(/path === "\/admin" \|\| path === "\/admin\/ai-learning"/);
    expect(script).toMatch(/ADMIN:\s*"ADMIN"/);
    expect(styles).toMatch(/body\.phase-admin #hud/);
  });

  it("routes players from name entry directly into the waiting lobby", () => {
    expect(script).toMatch(/accessContinueBtn\.addEventListener\("click", async \(\) =>/);
    expect(script).toMatch(/await enterWaitingLobby\(\)/);
    expect(script).toMatch(/setPhase\("LOBBY"\)/);
    expect(script).toMatch(/if \(!IS_ADMIN_VIEW\)\s*{\s*try\s*{\s*worker\.postMessage\(\{\s*type: "player\.info\.joining"/);
  });

  it("uses presenter socket commands instead of player admin claim for /admin start", () => {
    expect(script).toMatch(/type: "admin\.presenter\.start"/);
    expect(script).toMatch(/type: "admin\.presenter\.end"/);
    expect(worker).toMatch(/case "admin\.presenter\.start":/);
    expect(worker).toMatch(/emitWithAck\("admin\.presenter\.start"/);
    expect(worker).toMatch(/case "admin\.presenter\.end":/);
    expect(worker).toMatch(/emitWithAck\("admin\.presenter\.end"/);
    expect(server).toMatch(/socket\.on\("admin\.presenter\.start"/);
    expect(server).toMatch(/socket\.on\("admin\.presenter\.end"/);
    expect(server).toMatch(/DEMO_ADMIN_TOKEN/);
  });

  it("preserves waiting-room roster entries when stale gameplay traces age out", () => {
    expect(server).toMatch(/const roomState = roomTimers\.get\(room\)\?\.state \|\| gameState \|\| "WAITING"/);
    expect(server).toMatch(/if \(roomState !== "RUNNING"\)\s*{[\s\S]*deleteCache\(mapPlayersTraces, p\.id\)[\s\S]*continue;/);
  });

  it("serves the SPA for clean /admin URLs in dev and nginx", () => {
    const webpackDev = readFileSync("bundler/webpack.dev.js", "utf8");
    expect(webpackDev).toMatch(/historyApiFallback:\s*true/);
    expect(dockerfile).toMatch(/COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
    expect(nginx).toMatch(/try_files \$uri \$uri\/ \/index\.html;/);
  });
});
