import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("src/script.js", "utf8");
const worker = readFileSync("src/commsWorker.js", "utf8");

describe("gameplay polish regressions", () => {
  it("uses browser-safe short uuid generation for fresh players", () => {
    expect(script).toMatch(/import \{ createTranslator \} from "short-uuid";/);
    expect(script).toMatch(/function generatePlayerId\(\)/);
    expect(script).toMatch(/typeof globalThis\.crypto\.randomUUID === "function"/);
    expect(script).toMatch(/typeof globalThis\.crypto\.getRandomValues === "function"/);
    expect(script).toMatch(/localStorage\.setItem\("yourId", generatePlayerId\(\)\);/);
    expect(script).not.toMatch(/generateShortUuid\(\)/);
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

  it("replaces stale room items when authoritative items arrive", () => {
    expect(script).toMatch(/function syncAuthoritativeItems\(nextItems = \{\}\)/);
    expect(script).toMatch(/const nextIds = new Set\(Object\.keys\(scopedItems\)\);/);
    expect(script).toMatch(/for \(const itemId of Object\.keys\(items \|\| \{\}\)\)/);
    expect(script).toMatch(/removeItemFromScene\(itemId\);/);
    expect(script).toMatch(/case "items\.all":[\s\S]{0,80}syncAuthoritativeItems\(body\);/);
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
    expect(script).toMatch(/const TURTLE_WATERLINE_OFFSET = -0\.045;/);
    expect(script).toMatch(/const TURTLE_TURN_RESPONSE = 2\.8;/);
    expect(script).toMatch(/const TURTLE_VERTICAL_LERP = 0\.065;/);
    expect(script).toMatch(/const yawDelta = \(\(yaw - mesh\.rotation\.y \+ Math\.PI\) % \(Math\.PI \* 2\)\) - Math\.PI;/);
    expect(script).toMatch(/mesh\.rotation\.y \+= yawDelta \* Math\.min\(1, dt \* TURTLE_TURN_RESPONSE\);/);
    expect(script).toMatch(/const wave = getHeightAndNormal\(mesh\.position\.x, mesh\.position\.z, tSec\);/);
    expect(script).toMatch(/const downwardBob = -Math\.abs\(Math\.sin\(tSec \* floatSpeed \+ phase\)\) \* floatAmplitude;/);
    expect(script).toMatch(/const targetY = \(wave\.height \|\| 0\) \+ TURTLE_WATERLINE_OFFSET \+ downwardBob;/);
    expect(script).toMatch(/applyTilt\(mesh, wave\.normal, 0\.5, 0\.045\);/);
    expect(script).toMatch(/function resetTurtleFloatState\(object3d\)/);
    expect(script).toMatch(/object3d\.userData\.floatOffset = Math\.random\(\) \* Math\.PI \* 2;/);
    expect(script).toMatch(/object3d\.userData\.floatSpeed = TURTLE_BOB_SPEED_MIN \+ Math\.random\(\) \* \(TURTLE_BOB_SPEED_MAX - TURTLE_BOB_SPEED_MIN\);/);
    expect(script).toMatch(/object3d\.userData\.floatAmplitude = TURTLE_BOB_AMPLITUDE_MIN \+ Math\.random\(\) \* \(TURTLE_BOB_AMPLITUDE_MAX - TURTLE_BOB_AMPLITUDE_MIN\);/);
    expect(script).toMatch(/resetTurtleFloatState\(group\);/);
    expect(script).toMatch(/resetTurtleFloatState\(mesh\);/);
    expect(script).toMatch(/turtleSamples = Object\.values\(itemMeshes \|\| \{\}\)/);
    expect(script).toMatch(/turtlesVisible: turtleSamples\.length,/);
    expect(script).toMatch(/waterColor: ARCADE_ENVIRONMENT\.waterColor,/);
  });

  it("adds boat feel as a visual-only layer without changing gameplay collision root", () => {
    expect(script).toMatch(/createBoatFeelState,/);
    expect(script).toMatch(/installBoatFeelPivot,/);
    expect(script).toMatch(/updateBoatFeel,/);
    expect(script).toMatch(/function captureGameplayCollisionBox\(object3d\)/);
    expect(script).toMatch(/function getPlayerCollisionBox\(\)/);
    expect(script).toMatch(/object3d\.userData\.gameplayCollisionBoxLocal = playerCollisionWorldBox\.clone\(\)\.applyMatrix4\(playerCollisionMatrix\);/);
    expect(script).toMatch(/const playerRoot = new THREE\.Group\(\);/);
    expect(script).toMatch(/playerRoot\.name = "localPlayerGameplayRoot";/);
    expect(script).toMatch(/playerRoot\.add\(boat\);/);
    expect(script).toMatch(/captureGameplayCollisionBox\(player\);/);
    expect(script).toMatch(/localBoatFeelState = createBoatFeelState\(\);/);
    expect(script).toMatch(/installBoatFeelPivot\(player, \[boat\]\);/);
    expect(script).toMatch(/localWaterlineContact = createBoatWaterlineContact\(\);/);
    expect(script).toMatch(/player\.add\(localWaterlineContact\);/);
    expect(script).toMatch(/const playerBox = getPlayerCollisionBox\(\);/);
    expect(script).toMatch(/latestBoatFeelDebug = updateBoatFeel\(player, localBoatFeelState,/);
    expect(script).toMatch(/wakeRipples: wakeRippleEffect,/);
    expect(script).toMatch(/updateBoatWaterlineContact\(player, effectiveSignedSpeed, latestBoatFeelDebug\.wake, MAX_SPEED, latestBoatFeelDebug\.y\);/);
    expect(script).toMatch(/updateBoatFeel\(m, m\.userData && m\.userData\.boatFeel,/);
    expect(script).toMatch(/boatFeel: getBoatFeelDebug\(localBoatFeelState\) \|\| latestBoatFeelDebug,/);
    expect(script).toMatch(/import \{ createWakeRippleEffect \} from "\.\/wakeRipples";/);
    expect(script).toMatch(/wakeRippleEffect = createWakeRippleEffect\(scene, \{ mobile: window\.innerWidth < 800 \}\);/);
    expect(script).toMatch(/wakeRipples: latestWakeRippleDebug,/);
    expect(script).toMatch(/waterlineContact: latestWaterlineContactDebug,/);
    expect(script).toMatch(/if \(key === yourId\) \{/);
    expect(script).toMatch(/try \{ disableReflectionForSprite\(sprite\); \} catch \(_\) \{\}/);
  });

  it("pins the arcade-bright water and lightweight environment prop pass", () => {
    expect(script).toMatch(/const ARCADE_ENVIRONMENT = Object\.freeze\(\{/);
    expect(script).toMatch(/toneMappingExposure: 0\.6,/);
    expect(script).toMatch(/fogColor: 0x7fd4ef,/);
    expect(script).toMatch(/waterColor: 0x006fb8,/);
    expect(script).toMatch(/waterNormalRepeat: 5,/);
    expect(script).toMatch(/waterTimeStep: 1\.0 \/ 1800\.0,/);
    expect(script).toMatch(/skyMieCoefficient: 0\.0012,/);
    expect(script).toMatch(/sunElevation: 10,/);
    expect(script).toMatch(/sunAzimuth: 132,/);
    expect(script).toMatch(/renderer\.toneMappingExposure = ARCADE_ENVIRONMENT\.toneMappingExposure;/);
    expect(script).toMatch(/scene\.fog = new THREE\.FogExp2\(ARCADE_ENVIRONMENT\.fogColor, ARCADE_ENVIRONMENT\.fogDensity\);/);
    expect(script).toMatch(/waternormals\.repeat\.set\(\s*ARCADE_ENVIRONMENT\.waterNormalRepeat,\s*ARCADE_ENVIRONMENT\.waterNormalRepeat\s*\);/);
    expect(script).toMatch(/function createArcadeEnvironmentProps\(isMobileViewport\)/);
    expect(script).toMatch(/const ENVIRONMENT_PROP_LIMITS = Object\.freeze\(\{/);
    expect(script).toMatch(/desktop: 14,/);
    expect(script).toMatch(/mobile: 8,/);
    expect(script).toMatch(/child\.userData\.environmentProp = true;/);
    expect(script).toMatch(/child\.userData\.noCollision = true;/);
    expect(script).toMatch(/environmentPropsVisible: environmentPropStats\.total \|\| 0,/);
  });
});
