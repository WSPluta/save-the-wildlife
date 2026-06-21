import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("src/script.js", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const webpackDev = readFileSync("bundler/webpack.dev.js", "utf8");
const devStart = readFileSync("../scripts/dev_start.sh", "utf8");

describe("mobile touch controls", () => {
  it("creates a pointer-driven joystick that feeds throttle and steering", () => {
    expect(script).toMatch(/function setupTouchJoystick\(\)/);
    expect(script).toMatch(/touch-joystick/);
    expect(script).toMatch(/pointerdown/);
    expect(script).toMatch(/pointermove/);
    expect(script).toMatch(/pointerup/);
    expect(script).toMatch(/mobileInput\s*=\s*{\s*[\s\S]*throttle:/);
    expect(script).toMatch(/Number\(mobileInput\.throttle \|\| 0\)/);
    expect(script).toMatch(/Number\(mobileInput\.steer \|\| 0\)/);
  });

  it("maps mobile and keyboard axes to player-facing boat controls", () => {
    expect(script).toMatch(/const MOBILE_THROTTLE_AXIS = 1;/);
    expect(script).toMatch(/const MOBILE_STEER_AXIS = 1;/);
    expect(script).toMatch(/throttle:\s*Math\.max\(-1,\s*Math\.min\(1,\s*MOBILE_THROTTLE_AXIS \* -y \/ radius\)\)/);
    expect(script).toMatch(/steer:\s*Math\.max\(-1,\s*Math\.min\(1,\s*MOBILE_STEER_AXIS \* x \/ radius\)\)/);
    expect(script).toMatch(/keyboard\["ArrowLeft"\] \? -1 : 0/);
    expect(script).toMatch(/keyboard\["ArrowRight"\] \? 1 : 0/);
  });

  it("shows the joystick on coarse pointers during gameplay only", () => {
    expect(styles).toMatch(/\.touch-joystick\s*{[\s\S]*display:\s*none/);
    expect(styles).toMatch(/touch-action:\s*none/);
    expect(styles).toMatch(/pointer-events:\s*auto/);
    expect(styles).toMatch(/@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*780px\)/);
    expect(styles).toMatch(/body\.phase-gameplay\s+\.touch-joystick\s*{[\s\S]*display:\s*block/);
  });

  it("supports physical-phone testing over the local network", () => {
    expect(webpackDev).toMatch(/const WEB_HOST = process\.env\.WEB_HOST \|\| "0\.0\.0\.0";/);
    expect(webpackDev).toMatch(/host:\s*WEB_HOST/);
    expect(script).toMatch(/const wsURL = `\$\{scheme\}:\/\/\$\{location\.host\}`;/);
    expect(script).not.toContain('"http://localhost:3000"');
    expect(devStart).toMatch(/WEB_HOST="\$\{WEB_HOST:-0\.0\.0\.0\}"/);
    expect(devStart).toMatch(/Phone: open http:\/\/\$\{LAN_IP\}:\$\{WEB_PORT\}\/\?room=ROOM-0001/);
    expect(devStart).toMatch(/Admin: open http:\/\/\$\{LAN_IP\}:\$\{WEB_PORT\}\/admin\?room=ROOM-0001/);
  });
});
