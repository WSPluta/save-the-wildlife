import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("src/script.js", "utf8");
const styles = readFileSync("src/style.css", "utf8");

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

  it("shows the joystick on coarse pointers during gameplay only", () => {
    expect(styles).toMatch(/\.touch-joystick\s*{[\s\S]*display:\s*none/);
    expect(styles).toMatch(/touch-action:\s*none/);
    expect(styles).toMatch(/pointer-events:\s*auto/);
    expect(styles).toMatch(/@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*780px\)/);
    expect(styles).toMatch(/body\.phase-gameplay\s+\.touch-joystick\s*{[\s\S]*display:\s*block/);
  });
});
