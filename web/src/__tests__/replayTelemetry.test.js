import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(resolve(__dirname, "../script.js"), "utf8");

describe("replay telemetry evidence", () => {
  it("pairs replay JSON clips with the gameplay session id", () => {
    expect(script).toMatch(/sessionId:\s*currentSessionId/);
    expect(script).toMatch(/navigator\.sendBeacon\("\/api\/replay\/events"/);
  });

  it("captures replay moments for match-intelligence events", () => {
    expect(script).toMatch(/triggerReplayMoment\("powerup_collected"/);
    expect(script).toMatch(/triggerReplayMoment\("player_frozen"/);
    expect(script).toMatch(/triggerReplayMoment\("marine_hit"/);
    expect(script).toMatch(/triggerReplayMoment\("trash_collect"/);
  });
});
