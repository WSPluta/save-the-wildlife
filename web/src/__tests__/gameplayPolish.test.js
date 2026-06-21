import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("src/script.js", "utf8");
const worker = readFileSync("src/commsWorker.js", "utf8");
const assets = readFileSync("src/assets.js", "utf8");

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

  it("uses root-relative static assets so nested admin routes do not fetch /admin/assets", () => {
    expect(assets).toContain('loadGLTF("/assets/boat.gltf"');
    expect(assets).toContain('loadGLTF("/assets/turtle.gltf"');
    expect(assets).toContain('loadGLTF("/assets/box.gltf"');
    expect(assets).toContain('loadTexture("/assets/waternormals.jpg"');
    expect(assets).toContain('loadTexture("/assets/menu/logo.compressed.png"');
    expect(script).toContain('audioLoader.loadAsync("/assets/mixkit-motorboat-on-the-sea-1183.m4v")');
    expect(script).not.toMatch(/["']assets\//);
  });

  it("renders demo bots as bounded visible participants for gameplay and commentary proof", () => {
    expect(script).toMatch(/const BOT_RENDER_MODE = "demo-visible";/);
    expect(script).toMatch(/const BOT_VISUAL_SCALE = 0\.28;/);
    expect(script).toMatch(/const BOT_VISUAL_COLOR = 0x15c7b8;/);
    expect(script).toMatch(/function isBotDisplayName\(name\)/);
    expect(script).toMatch(/function isBotPlayerId\(id\)/);
    expect(script).toMatch(/function shouldRenderRemotePlayer\(id\)/);
    expect(script).toMatch(/function removeRemotePlayerVisual\(id\)/);
    expect(script).toMatch(/let ensureBotRosterVisualsForScene = \(\) => \{\};/);
    expect(script).toMatch(/function styleBotRemoteBoat\(group, mesh, lodLow\)/);
    expect(script).toMatch(/function keepBotRemoteBoatVisible\(group\)/);
    expect(script).toMatch(/function ensureBotRosterVisuals\(\)/);
    expect(script).toMatch(/`BOT \$\{String\(id \|\| ""\)\.slice\(4, 8\)\}`/);
    expect(script).toMatch(/const botIds = Object\.keys\(otherPlayersInfo \|\| \{\}\)\.filter/);
    expect(script).toMatch(/rosterFallback: true,/);
    expect(script).toMatch(/group\.scale\.setScalar\(BOT_VISUAL_SCALE\);/);
    expect(script).toMatch(/group\.frustumCulled = false;/);
    expect(script).toMatch(/keepBotRemoteBoatVisible\(otherPlayersMeshes\[id\]\);/);
    expect(script).toMatch(/if \(g\.userData && g\.userData\.isBot\) \{[\s\S]{0,120}g\.visible = true;[\s\S]{0,120}g\.frustumCulled = false;/);
    expect(script).toMatch(/clone\.color\.lerp\(new THREE\.Color\(BOT_VISUAL_COLOR\), 0\.72\);/);
    expect(script).toMatch(/releaseRemoteBoatVisual = returnBoatToPool;/);
    expect(script).toMatch(/if \(!shouldRenderRemotePlayer\(key\)\)/);
    expect(script).toMatch(/if \(!shouldRenderRemotePlayer\(joinedId\)\)/);
    expect(script).toMatch(/ensureBotRosterVisuals\(\);/);
    expect(script).toMatch(/createItemMeshForScene = createItemMesh;\s*ensureBotRosterVisuals\(\);/);
    expect(script).toMatch(/ensureBotRosterVisualsForScene = ensureBotRosterVisuals;/);
    expect(script).toMatch(/try \{ ensureBotRosterVisualsForScene\(\); \} catch \(_\) \{\}/);
    expect(script).toMatch(/const infoCount = Object\.keys\(otherPlayersInfo \|\| \{\}\)\.length;/);
    expect(script).toMatch(/botsVisible: botSamples\.length,/);
    expect(script).toMatch(/botsKnown: Math\.max\(knownBotCount, botSamples\.length\),/);
    expect(script).toMatch(/botRenderMode: BOT_RENDER_MODE,/);
    expect(script).toMatch(/botSamples,/);
    expect(script).toMatch(/botRosterVisual: latestBotRosterVisualDebug,/);
  });

  it("clamps trash and power-up visual scale so bad telemetry cannot become walls", () => {
    expect(script).toMatch(/const TRASH_VISUAL_SCALE_MIN = 0\.34;/);
    expect(script).toMatch(/const TRASH_VISUAL_SCALE_MAX = 0\.74;/);
    expect(script).toMatch(/const TRASH_FLOAT_Y = 0\.028;/);
    expect(script).toMatch(/const TRASH_GEOMETRY_WIDTH = 0\.34;/);
    expect(script).toMatch(/const TRASH_GEOMETRY_HEIGHT = 0\.07;/);
    expect(script).toMatch(/const TRASH_GEOMETRY_DEPTH = 0\.22;/);
    expect(script).toMatch(/const POWERUP_VISUAL_SCALE_MIN = 0\.38;/);
    expect(script).toMatch(/const POWERUP_VISUAL_SCALE_MAX = 0\.82;/);
    expect(script).toMatch(/const TRASH_ARCADE_PICKUP_RADIUS = 3\.4;/);
    expect(script).toMatch(/const POWERUP_ARCADE_PICKUP_RADIUS = 3\.4;/);
    expect(script).toMatch(/function clampVisualScale\(size, min, max\)/);
    expect(script).toMatch(/function isWithinArcadePickupRadius\(position, radius\)/);
    expect(script).toMatch(/new THREE\.BoxGeometry\(TRASH_GEOMETRY_WIDTH, TRASH_GEOMETRY_HEIGHT, TRASH_GEOMETRY_DEPTH\)/);
    expect(script).toMatch(/trashTmpPos\.set\(position\.x, waterY \+ TRASH_FLOAT_Y, position\.z\);/);
    expect(script).toMatch(/trashTmpPos\.set\(ix, waterY \+ TRASH_FLOAT_Y, iz\);/);
    expect(script).toMatch(/clampVisualScale\(size, TRASH_VISUAL_SCALE_MIN, TRASH_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/clampVisualScale\(size, POWERUP_VISUAL_SCALE_MIN, POWERUP_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/clampVisualScale\(item\.size, TRASH_VISUAL_SCALE_MIN, TRASH_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/clampVisualScale\(item\.size, POWERUP_VISUAL_SCALE_MIN, POWERUP_VISUAL_SCALE_MAX\)/);
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
    expect(script).toMatch(/BOAT_FEEL_DEFAULTS,/);
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
    expect(script).toMatch(/new THREE\.RingGeometry\(0\.41, 0\.5, 48, 1\);/);
    expect(script).toMatch(/depthTest: true,/);
    expect(script).toMatch(/localWaterlineContact\.scale\.set\(0\.38 \+ wakeStrength \* 0\.035, 1, 1\.06 \+ speedRatio \* 0\.08\);/);
    expect(script).toMatch(/player\.add\(localWaterlineContact\);/);
    expect(script).toMatch(/const playerBox = getPlayerCollisionBox\(\);/);
    expect(script).toMatch(/isWithinArcadePickupRadius\(item\.position, TRASH_ARCADE_PICKUP_RADIUS\)/);
    expect(script).toMatch(/isWithinArcadePickupRadius\(item\.position, POWERUP_ARCADE_PICKUP_RADIUS\)/);
    expect(script).toMatch(/latestBoatFeelDebug = updateBoatFeel\(player, localBoatFeelState,/);
    expect(script).toMatch(/wakeRipples: wakeRippleEffect,/);
    expect(script).toMatch(/updateBoatWaterlineContact\(\s*player,\s*effectiveSignedSpeed,\s*latestBoatFeelDebug\.wake,\s*MAX_SPEED,\s*latestBoatFeelDebug\.y,\s*latestBoatFeelDebug\.surfaceY\s*\);/);
    expect(script).toMatch(/updateBoatFeel\(m, m\.userData && m\.userData\.boatFeel,/);
    expect(script).toMatch(/boatFeel: getBoatFeelDebug\(localBoatFeelState\) \|\| latestBoatFeelDebug,/);
    expect(script).toMatch(/import \{ createWakeRippleEffect \} from "\.\/wakeRipples";/);
    expect(script).toMatch(/wakeRippleEffect = createWakeRippleEffect\(scene, \{ mobile: window\.innerWidth < 800 \}\);/);
    expect(script).toMatch(/wakeRipples: latestWakeRippleDebug,/);
    expect(script).toMatch(/waterlineContact: latestWaterlineContactDebug,/);
    expect(script).toMatch(/if \(key === yourId\) \{/);
    expect(script).toMatch(/try \{ disableReflectionForSprite\(sprite\); \} catch \(_\) \{\}/);
  });

  it("uses a mobile-aware follow camera without changing the gameplay root", () => {
    expect(script).toMatch(/const FOLLOW_CAMERA_COMPOSITION = Object\.freeze\(\{/);
    expect(script).toMatch(/desktop: \{[\s\S]{0,140}distance: 2\.35,[\s\S]{0,80}height: 1\.05,[\s\S]{0,80}lookHeight: 0\.16,[\s\S]{0,80}lookForward: 0\.45,[\s\S]{0,120}fov: 75,/);
    expect(script).toMatch(/mobile: \{[\s\S]{0,140}distance: 2\.9,[\s\S]{0,80}height: 1\.28,[\s\S]{0,80}lookHeight: 0\.3,[\s\S]{0,80}lookForward: 0\.44,[\s\S]{0,120}fov: 70,/);
    expect(script).toMatch(/function isMobileGameViewport\(\)/);
    expect(script).toMatch(/window\.matchMedia && window\.matchMedia\("\(pointer: coarse\)"\)\.matches/);
    expect(script).toMatch(/function applyFollowCamera\(root, yaw\)/);
    expect(script).toMatch(/let shouldSnapFollowCamera = true;/);
    expect(script).toMatch(/camera\.position\.copy\(followCameraTargetPosition\);/);
    expect(script).toMatch(/camera\.position\.lerp\(followCameraTargetPosition, composition\.spring\);/);
    expect(script).toMatch(/followCameraLookTarget\.y \+= composition\.lookHeight;/);
    expect(script).toMatch(/camera\.lookAt\(followCameraLookTarget\);/);
    expect(script).toMatch(/applyFollowCamera\(player, player\.rotation\.y\);/);
    expect(script).toMatch(/camera: latestCameraCompositionDebug,/);
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
