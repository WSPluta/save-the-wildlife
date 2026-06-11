import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("src/script.js", "utf8");
const worker = readFileSync("src/commsWorker.js", "utf8");

describe("gameplay polish regressions", () => {
  it("uses browser-safe short uuid generation for fresh players", () => {
    expect(script).toMatch(/import \{ generate as generateShortUuid \} from "short-uuid";/);
    expect(script).toMatch(/localStorage\.setItem\("yourId", generateShortUuid\(\)\);/);
    expect(script).not.toMatch(/short\.generate\(\)/);
  });

  it("uses the presenter start path for dev/test autostart", () => {
    expect(script).toMatch(/function requestAutoStartMatch\(\)/);
    expect(script).toMatch(/type: "admin\.presenter\.start"/);
    expect(script).not.toMatch(/autoStartMatch[\s\S]{0,180}admin\.claim/);
  });

  it("keeps item collisions pending until the server accepts or destroys the item", () => {
    expect(script).toMatch(/const pendingItemCollisions = new Map\(\);/);
    expect(script).toMatch(/function markItemCollisionPending\(itemId, itemType\)/);
    expect(script).toMatch(/case "items\.collision\.result":/);
    expect(script).toMatch(/applyConfirmedCollisionOutcome\(payload\);/);
    expect(script).toMatch(/removeItemFromScene\(payload\.itemId \|\| payload\.id\);/);
    expect(worker).toMatch(/socket\.timeout\(1200\)\.emit\("items\.collision"/);
  });

  it("drives replay and telemetry from confirmed collision evidence", () => {
    expect(script).toMatch(/function applyConfirmedCollisionOutcome\(rawPayload\)/);
    expect(script).toMatch(/emitGameplayEvent\("trash_collected"/);
    expect(script).toMatch(/triggerReplayMomentCallback\("trash_collect"/);
    expect(script).toMatch(/emitGameplayEvent\("powerup_collected"/);
    expect(script).toMatch(/triggerReplayMomentCallback\("powerup_collected"/);
  });

  it("turns turtles toward movement and applies lightweight buoyancy", () => {
    expect(script).toMatch(/import \{ applyTilt, getHeightAndNormal \} from "\.\/buoyancy";/);
    expect(script).toMatch(/const yawDelta = \(\(yaw - mesh\.rotation\.y \+ Math\.PI\) % \(Math\.PI \* 2\)\) - Math\.PI;/);
    expect(script).toMatch(/mesh\.rotation\.y \+= yawDelta \* Math\.min\(1, dt \* 4\.5\);/);
    expect(script).toMatch(/const wave = getHeightAndNormal\(mesh\.position\.x, mesh\.position\.z, tSec\);/);
    expect(script).toMatch(/applyTilt\(mesh, wave\.normal, 0\.65, 0\.08\);/);
    expect(script).toMatch(/group\.userData\.floatOffset = Math\.random\(\) \* Math\.PI \* 2;/);
  });
});
