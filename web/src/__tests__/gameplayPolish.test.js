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
    expect(script).toMatch(/function getOrCreatePlayerId\(\)/);
    expect(script).toMatch(/function urlHasExplicitJoinIdentity\(\)/);
    expect(script).toMatch(/sessionStorage\.setItem\(PLAYER_TAB_ID_STORAGE_KEY, next\)/);
    expect(script).toMatch(/localStorage\.setItem\(PLAYER_ID_STORAGE_KEY, next\)/);
    expect(script).not.toMatch(/generateShortUuid\(\)/);
  });

  it("exposes local player and gameplay session identity in render_game_to_text", () => {
    expect(script).toMatch(/playerId:\s*yourId/);
    expect(script).toMatch(/playerName:\s*currentDisplayName\(\)/);
    expect(script).toMatch(/roomId:\s*roomId \|\| null/);
    expect(script).toMatch(/clientSessionId/);
    expect(script).toMatch(/gameplaySessionId:\s*currentSessionId \|\| null/);
  });

  it("keeps final score aligned to authoritative server scores or accepted local collisions", () => {
    expect(script).toMatch(/import \{ finalScoreFromSources \} from "\.\/scoreIntegrity";/);
    expect(script).toMatch(/function finalScoreFromEndPayload\(endPayload = \{\}\)/);
    expect(script).toMatch(/finalScoreFromSources\(\{[\s\S]{0,160}playerId: yourId,[\s\S]{0,120}localScore,/);
    expect(script).toMatch(/const finalScore = finalScoreFromEndPayload\(endPayload\);/);
    expect(script).toMatch(/finitePayloadNumber\(payload\.score, payload\.serverScore\)/);
    expect(script).not.toMatch(/Math\.max\(0,\s*Math\.round\(finalScoreFromEndPayload/);
  });

  it("starts gameplay telemetry when game.on follows an early RUNNING state", () => {
    expect(script).toMatch(/const shouldStartGameplayTelemetry = gameState !== "RUNNING" \|\| !currentSessionId;/);
    expect(script).toMatch(/if \(shouldStartGameplayTelemetry\) \{[\s\S]{0,180}resetGameplayTelemetry\(\);[\s\S]{0,120}emitGameplayEvent\("game_started"/);
  });

  it("does not reset or re-register the local boat on duplicate game.on events", () => {
    const start = script.indexOf('case "game.on":');
    const end = script.indexOf('case "game.end":', start);
    const gameOnBlock = script.slice(start, end);
    expect(gameOnBlock).toMatch(/if \(clientGameStarted && shouldStartGameplayTelemetry\) \{/);
    expect(gameOnBlock).not.toMatch(/type: "game\.start"/);
  });

  it("uses the presenter start path for dev/test autostart", () => {
    expect(script).toMatch(/function requestAutoStartMatch\(\)/);
    expect(script).toMatch(/type: "admin\.presenter\.start"/);
    expect(script).not.toMatch(/autoStartMatch[\s\S]{0,180}admin\.claim/);
  });

  it("does not honor debug URL start flags on public hosts", () => {
    expect(script).toMatch(/function isLocalDebugHost\(hostname = window\.location\.hostname\)/);
    expect(script).toMatch(/const localDebugUrlFlagsAllowed = isLocalDebugHost\(url\.hostname\);/);
    expect(script).toMatch(/localDebugUrlFlagsAllowed && url\.searchParams\.get\("autostart"\) === "1"/);
    expect(script).toMatch(/localDebugUrlFlagsAllowed && url\.searchParams\.get\("joinRunning"\) === "1"/);
    expect(script).toMatch(/Public demos must[\s\S]{0,80}presenter\/admin start path/);
  });

  it("keeps normal public room entry in the lobby until the presenter countdown", () => {
    expect(script).toMatch(/let allowJoinRunningMatch = false;/);
    expect(script).toMatch(/url\.searchParams\.get\("joinRunning"\) === "1"/);
    expect(script).toMatch(/currentPhase === "LOBBY" && gameState !== "STARTING" && !autoStartMatch && !allowJoinRunningMatch/);
    expect(script).toMatch(/incomingState === "RUNNING" && currentPhase === "LOBBY" && !autoStartMatch && !allowJoinRunningMatch/);
    expect(script).toMatch(/Waiting for presenter start/);
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
    expect(script).toMatch(/const BOT_VISUAL_SCALE = 0\.34;/);
    expect(script).toMatch(/const BOT_VISUAL_COLOR = 0x15c7b8;/);
    expect(script).toMatch(/function isBotDisplayName\(name\)/);
    expect(script).toMatch(/function isBotPlayerId\(id\)/);
    expect(script).toMatch(/info && info\.isBot/);
    expect(script).toMatch(/function shouldRenderRemotePlayer\(id\)/);
    expect(script).toMatch(/function removeRemotePlayerVisual\(id\)/);
    expect(script).toMatch(/let ensureBotRosterVisualsForScene = \(\) => \{\};/);
    expect(script).toMatch(/function styleBotRemoteBoat\(group, mesh, lodLow\)/);
    expect(script).toMatch(/function keepBotRemoteBoatVisible\(group\)/);
    expect(script).toMatch(/function ensureBotRosterVisuals\(\)/);
    expect(script).toMatch(/function botDemoLabel\(\) \{\s*return "BOT";\s*\}/);
    expect(script).toMatch(/const BOT_NAME_TAG_SCALE = Object\.freeze\(\{ x: 0\.32, y: 0\.1, z: 1 \}\);/);
    expect(script).toMatch(/function configureNameTagForOwner\(sprite, object3d\)/);
    expect(script).toMatch(/sprite\.scale\.set\(scale\.x, scale\.y, scale\.z\);/);
    expect(script).toMatch(/\.\.\.Object\.keys\(otherPlayersInfo \|\| \{\}\),/);
    expect(script).toMatch(/\.\.\.botProfileEvidence\.keys\(\),/);
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
    expect(script).toMatch(/const botProfileEvidence = new Map\(\);/);
    expect(script).toMatch(/function mergeBotProfileEvidence\(id, profile = \{\}\)/);
    expect(script).toMatch(/function mergePlayerProfileEvidence\(id, profile = \{\}\)/);
    expect(script).toMatch(/function isMeaningfulPlayerName\(name, id\)/);
    expect(script).toMatch(/function getBotPolicyForPlayer\(id\)/);
    expect(script).toMatch(/rememberBotProfileEvidence\(key, \{/);
    expect(script).toMatch(/botPolicy: traceData\.botPolicy,/);
    expect(script).toMatch(/botProfileEvidence\.keys\(\)/);
    expect(script).toMatch(/botPolicy: policy \? compactBotPolicyEvidence\(policy\) : null,/);
    expect(script).toMatch(/botSamples,/);
    expect(script).toMatch(/botRosterVisual: latestBotRosterVisualDebug,/);
  });

  it("keeps trash and power-ups readable without turning pickups into wall geometry", () => {
    expect(script).toMatch(/const TRASH_VISUAL_SCALE_MIN = 1\.08;/);
    expect(script).toMatch(/const TRASH_VISUAL_SCALE_MAX = 1\.42;/);
    expect(script).toMatch(/const TRASH_FLOAT_Y = 0\.08;/);
    expect(script).toMatch(/const POWERUP_FLOAT_Y = 0\.34;/);
    expect(script).toMatch(/const TRASH_GEOMETRY_WIDTH = 1\.0;/);
    expect(script).toMatch(/const TRASH_GEOMETRY_HEIGHT = 0\.13;/);
    expect(script).toMatch(/const TRASH_GEOMETRY_DEPTH = 0\.66;/);
    expect(script).toMatch(/const POWERUP_VISUAL_SCALE_MIN = 0\.68;/);
    expect(script).toMatch(/const POWERUP_VISUAL_SCALE_MAX = 1\.22;/);
    expect(script).toMatch(/const BOAT_FOOTPRINT_RADIUS = 1\.25;/);
    expect(script).toMatch(/const TRASH_FOOTPRINT_HALF_WIDTH = 0\.5;/);
    expect(script).toMatch(/const TRASH_FOOTPRINT_HALF_DEPTH = 0\.33;/);
    expect(script).toMatch(/const TRASH_FOOTPRINT_RADIUS = 0\.95;/);
    expect(script).toMatch(/const POWERUP_FOOTPRINT_RADIUS = 1\.05;/);
    expect(script).toMatch(/const TURTLE_FOOTPRINT_RADIUS = 1\.35;/);
    expect(script).toMatch(/const PICKUP_TOUCH_FORGIVENESS = 0\.2;/);
    expect(script).toMatch(/const CANONICAL_BOAT_TURN_SPEED = 0\.78;/);
    expect(script).toMatch(/const GAMEPLAY_PARTICLES_ENABLED = false;/);
    expect(script).toMatch(/const ENGINE_WAKE_PARTICLES_ENABLED = false;/);
    expect(script).toMatch(/function clampVisualScale\(size, min, max\)/);
    expect(script).toMatch(/function isWithinFootprintOverlap\(position, itemRadius, boatRadius = BOAT_FOOTPRINT_RADIUS\)/);
    expect(script).toMatch(/function isWithinTrashBoxFootprint\(position, scale = 1, boatRadius = BOAT_FOOTPRINT_RADIUS\)/);
    expect(script).toMatch(/function itemFootprintRadius\(itemType, scale = 1\)/);
    expect(script).toMatch(/function isGameplayPrimitiveOverlap\(position, itemType, scale = 1\)/);
    expect(script).toMatch(/return isWithinTrashBoxFootprint\(position, scale\)\s*\|\| isWithinFootprintOverlap\(position, itemFootprintRadius\(itemType, scale\)\);/);
    expect(script).toMatch(/new THREE\.BoxGeometry\(TRASH_GEOMETRY_WIDTH, TRASH_GEOMETRY_HEIGHT, TRASH_GEOMETRY_DEPTH\)/);
    expect(script).toMatch(/const trashDetailGeometry = new THREE\.BoxGeometry/);
    expect(script).toMatch(/const detailMesh = new THREE\.InstancedMesh\(trashDetailGeometry, trashDetailMaterial, TRASH_INSTANCE_MAX\);/);
    expect(script).toMatch(/return \{ mesh, detailMesh, free, map: new Map\(\), max: TRASH_INSTANCE_MAX \};/);
    expect(script).toMatch(/trashInstances\.detailMesh\.setMatrixAt\(idx, trashTmpMatrix\);/);
    expect(script).toMatch(/trashTmpPos\.set\(position\.x, waterY \+ TRASH_FLOAT_Y, position\.z\);/);
    expect(script).toMatch(/trashTmpPos\.set\(ix, waterY \+ TRASH_FLOAT_Y, iz\);/);
    expect(script).toMatch(/clampVisualScale\(size, TRASH_VISUAL_SCALE_MIN, TRASH_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/clampVisualScale\(size, POWERUP_VISUAL_SCALE_MIN, POWERUP_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/clampVisualScale\(item\.size, TRASH_VISUAL_SCALE_MIN, TRASH_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/clampVisualScale\(item\.size, POWERUP_VISUAL_SCALE_MIN, POWERUP_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/visualScale: Number\(clampVisualScale\(item\.size, TRASH_VISUAL_SCALE_MIN, TRASH_VISUAL_SCALE_MAX\)/);
    expect(script).toMatch(/pickupFootprints: \{/);
    expect(script).toMatch(/trashShape: "box",/);
    expect(script).toMatch(/touchForgiveness: PICKUP_TOUCH_FORGIVENESS,/);
    expect(script).toMatch(/trashFloatY: TRASH_FLOAT_Y,/);
    expect(script).toMatch(/powerupFloatY: POWERUP_FLOAT_Y,/);
    expect(script).toMatch(/engineParticles: ENGINE_WAKE_PARTICLES_ENABLED/);
  });

  it("keeps item collisions pending until the server accepts or destroys the item", () => {
    expect(script).toMatch(/const pendingItemCollisions = new Map\(\);/);
    expect(script).toMatch(/function markItemCollisionPending\(itemId, itemType\)/);
    expect(script).toMatch(/case "items\.collision\.result":/);
    expect(script).toMatch(/latestPickupDebug = \{/);
    expect(script).toMatch(/allowedRadius: Number\.isFinite\(Number\(body\.allowedRadius\)\)/);
    expect(script).toMatch(/applyConfirmedCollisionOutcome\(payload\);/);
    expect(script).toMatch(/removeItemFromScene\(payload\.itemId \|\| payload\.id\);/);
    expect(worker).toMatch(/socket\.timeout\(2500\)\.emit\("items\.collision"/);
  });

  it("creates remote boats from authoritative player state snapshots", () => {
    expect(script).toMatch(/function ensureRemotePlayerVisual\(id, state\)/);
    expect(script).toMatch(/let ensureRemotePlayerVisualForScene = \(\) => null;/);
    expect(script).toMatch(/ensureRemotePlayerVisualForScene = ensureRemotePlayerVisual;/);
    expect(script).toMatch(/Object\.entries\(authStates\)\.forEach\(\(\[id, state\]\) =>/);
    expect(script).toMatch(/ensureRemotePlayerVisualForScene\(id, state\);/);
    expect(script).toMatch(/let authStateSeenAt = \{\};/);
    expect(script).toMatch(/state\.name \|\| state\.isBot \|\| state\.teacher \|\| state\.botPolicy/);
    expect(script).toMatch(/otherPlayersInfo\[id\] = mergePlayerProfileEvidence\(id,/);
    expect(script).toMatch(/isMeaningfulPlayerName\(incomingName, playerId\)/);
    expect(script).toMatch(/isMeaningfulPlayerName\(existingName, playerId\)/);
    expect(script).toMatch(/refreshNameTagForPlayer\(id\);/);
    expect(script).toMatch(/authStates\[id\] = state;/);
    expect(script).toMatch(/authStateSeenAt\[id\] = receivedAt;/);
    expect(script).toMatch(/REMOTE_AUTH_STATE_STALE_MS = 3000/);
    expect(script).toMatch(/const REMOTE_PLAYER_POSITION_SMOOTHING = 7\.5;/);
    expect(script).toMatch(/const REMOTE_PLAYER_ROTATION_SMOOTHING = 8\.5;/);
    expect(script).toMatch(/const REMOTE_PLAYER_FROZEN_SMOOTHING = 3\.5;/);
    expect(script).toMatch(/const REMOTE_PLAYER_MAX_VISUAL_STEP = 0\.65;/);
    expect(script).toMatch(/function remoteStateCoords\(state\)/);
    expect(script).toMatch(/function seedRemotePlayerVisualFromState\(mesh, state, \{ force = false \} = \{\}\)/);
    expect(script).toMatch(/function smoothRemotePlayerVisualToState\(mesh, state, lerpFactor\)/);
    expect(script).toMatch(/group\.userData\.remotePositionInitialized = false;/);
    expect(script).toMatch(/seedRemotePlayerVisualFromState\(otherPlayersMeshes\[key\], traceData\);/);
    expect(script).toMatch(/smoothRemotePlayerVisualToState\(m, s, lerpFactor\);/);
    expect(script).toMatch(/smoothRemotePlayerVisualToState\(playerMeshes\[id\], otherPlayers\[id\], lerpFactor\);/);
    expect(script).toMatch(/const REMOTE_PLAYER_LOCAL_SUPPRESSION_RADIUS = 0\.95;/);
    expect(script).toMatch(/const REMOTE_PLAYER_LABEL_SUPPRESSION_RADIUS = 4\.5;/);
    expect(script).toMatch(/const NAME_TAG_MAX_GRAPHEMES = 12;/);
    expect(script).toMatch(/function compactNameTagText\(text\)/);
    expect(script).toMatch(/function remoteDistanceToLocal2d\(x, z\)/);
    expect(script).toMatch(/function shouldSuppressRemoteNearLocal\(id, positionLike\)/);
    expect(script).toMatch(/function setRemoteLocalSuppression\(group, suppressed, distance = null\)/);
    expect(script).toMatch(/group\.userData\.localLabelSuppressed = !!labelSuppressed;/);
    expect(script).toMatch(/applyNameTagSuppression\(group\);/);
    expect(script).toMatch(/setRemoteLocalSuppression\(m, suppressNearLocal, suppressionDistance\);/);
    expect(script).toMatch(/if \(!suppressNearLocal\) addTrailPoint\(id, m\.position\);/);
    expect(script).toMatch(/visualX: Number\(\(Number\(mesh\.position\?\.x\) \|\| 0\)\.toFixed\(3\)\),/);
    expect(script).toMatch(/visualSource: hasVisualMesh \? "mesh" : null,/);
    expect(script).toMatch(/const CANONICAL_BOAT_ACCELERATION = 6;/);
    expect(script).toMatch(/const CANONICAL_BOAT_BRAKE = 1\.8;/);
    expect(script).toMatch(/const CANONICAL_BOAT_MAX_SPEED = 3;/);
    expect(script).toMatch(/const CANONICAL_BOAT_FRICTION = 0\.18;/);
    expect(script).toMatch(/const CANONICAL_BOAT_TURN_SPEED = 0\.78;/);
    expect(script).toMatch(/const remoteDt = Math\.max\(0\.001, Math\.min\(0\.05, frameDt \|\| 0\.016\)\);/);
    expect(script).toMatch(/const lerpFactor = 1 - Math\.exp\(-remoteRate \* remoteDt\);/);
    expect(script).toMatch(/const rotLerpFactor = 1 - Math\.exp\(-remoteRotRate \* remoteDt\);/);
    expect(script).toMatch(/if \(gameState !== "RUNNING"\) \{[\s\S]{0,220}playerSpeed = 0;[\s\S]{0,80}return;/);
    expect(script).toMatch(/player\.position\.addScaledVector\(direction, effectiveSignedSpeed \* dt\);/);
    expect(script).toMatch(/const steer = Math\.max\(-1, Math\.min\(1, \(keyboard\["ArrowLeft"\] \? -1 : 0\) \+ \(keyboard\["ArrowRight"\] \? 1 : 0\) \+ Number\(mobileInput\.steer \|\| 0\)\)\);/);
    expect(script).toMatch(/if \(gameState === "RUNNING" && sendYourPosition\) sendYourPosition\(\);/);
    expect(script).toMatch(/updateBoatFeel\(player, localBoatFeelState,[\s\S]{0,260}applyFollowCamera\(player, player\.rotation\.y\);/);
  });

  it("resets the visible timer from the server duration when gameplay actually starts", () => {
    expect(script).toMatch(/case "game\.on":/);
    expect(script).toMatch(/if \(Number\.isFinite\(gameDuration\)\) \{[\s\S]{0,160}lastServerTimeSyncValue = Number\(gameDuration\);[\s\S]{0,120}lastServerTimeSyncAtMs = Date\.now\(\);[\s\S]{0,120}renderTimeValue\(gameDuration\);/);
  });

  it("waits for game.on before unlocking gameplay controls from RUNNING state", () => {
    expect(script).toMatch(/if \(!clientGameStarted \|\| !currentSessionId\) \{[\s\S]{0,220}Wait for game\.on[\s\S]{0,220}gameState = "STARTING";[\s\S]{0,220}break;/);
  });

  it("surfaces frame-rate and frame-time diagnostics in the gameplay HUD", () => {
    const index = readFileSync("src/index.html", "utf8");
    expect(index).toContain('id="compact-fps"');
    expect(script).toMatch(/const compactFpsEl = document\.getElementById\("compact-fps"\);/);
    expect(script).toMatch(/const fps = Number\.isFinite\(renderStats\.fps\) \? renderStats\.fps\.toFixed\(1\) : "-";/);
    expect(script).toMatch(/const frame = Number\.isFinite\(renderStats\.frameMs\) \? renderStats\.frameMs\.toFixed\(1\) : "-";/);
    expect(script).toMatch(/compactFpsEl\.innerText = `FPS: \$\{fps\} \/ \$\{frame\}ms \/ lag \$\{lag\}ms`;/);
    expect(script).toMatch(/frame: \{/);
    expect(script).toMatch(/fps: Number\(\(renderStats\.fps \|\| 0\)\.toFixed\(1\)\),/);
    expect(script).toMatch(/rawFrameMs: Number\(\(\(frameDt \|\| 0\) \* 1000\)\.toFixed\(2\)\),/);
    expect(script).toMatch(/localAuthPositionSmoothing: LOCAL_AUTH_POSITION_SMOOTHING,/);
    expect(script).toMatch(/remotePositionSmoothing: REMOTE_PLAYER_POSITION_SMOOTHING,/);
    expect(script).toMatch(/animateItems\(\);[\s\S]{0,220}animateOtherPlayers\(otherPlayersMeshes\);[\s\S]{0,220}render\(\);/);
  });

  it("uses a conservative renderer profile for smooth first-person play", () => {
    expect(script).toMatch(/const RENDER_PIXEL_RATIO_DESKTOP_MAX = 1\.25;/);
    expect(script).toMatch(/const RENDER_PIXEL_RATIO_MOBILE_MAX = 1;/);
    expect(script).toMatch(/const WATER_REFLECTION_TEXTURE_SIZE = 256;/);
    expect(script).toMatch(/const REALTIME_SHADOWS_ENABLED = false;/);
    expect(script).toMatch(/function getRendererPixelRatio\(\)/);
    expect(script).toMatch(/renderer = new THREE\.WebGLRenderer\(\{[\s\S]{0,80}antialias: false,/);
    expect(script).toMatch(/renderer\.setPixelRatio\(getRendererPixelRatio\(\)\);/);
    expect(script).toMatch(/renderer\.shadowMap\.enabled = REALTIME_SHADOWS_ENABLED;/);
    expect(script).toMatch(/textureWidth: WATER_REFLECTION_TEXTURE_SIZE,/);
    expect(script).toMatch(/textureHeight: WATER_REFLECTION_TEXTURE_SIZE,/);
  });

  it("replaces stale room items when authoritative items arrive", () => {
    expect(script).toMatch(/function syncAuthoritativeItems\(nextItems = \{\}\)/);
    expect(script).toMatch(/function normalizeAuthoritativeItemsPayload\(nextItems = \{\}\)/);
    expect(script).toMatch(/const currentRoom = normalizeRoomId\(roomId\);/);
    expect(script).toMatch(/if \(payloadRoom && currentRoom && payloadRoom !== currentRoom\) return;/);
    expect(script).toMatch(/if \(!payloadRoom && currentRoom && itemRooms\.size > 0 && !itemRooms\.has\(currentRoom\)\)/);
    expect(script).toMatch(/if \(currentRoom && itemRoom && itemRoom !== currentRoom\) continue;/);
    expect(script).toMatch(/const nextIds = new Set\(Object\.keys\(scopedItems\)\);/);
    expect(script).toMatch(/for \(const itemId of Object\.keys\(items \|\| \{\}\)\)/);
    expect(script).toMatch(/removeItemFromScene\(itemId\);/);
    expect(script).toMatch(/case "items\.all":[\s\S]{0,80}syncAuthoritativeItems\(body\);/);
  });

  it("drives replay and telemetry from confirmed collision evidence", () => {
    expect(script).toMatch(/function applyConfirmedCollisionOutcome\(rawPayload, options = \{\}\)/);
    expect(script).toMatch(/const forceLocalOutcome = options && options\.localAck === true && payload\.ok === true;/);
    expect(script).toMatch(/applyConfirmedCollisionOutcome\(payload, \{ localAck: true \}\);/);
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
    expect(script).toMatch(/const TURTLE_VISUAL_SCALE = 0\.58;/);
    expect(script).toMatch(/turtle\.scale\.setScalar\(TURTLE_VISUAL_SCALE\);/);
    expect(script).toMatch(/userData\.turtle\.scale\.setScalar\(TURTLE_VISUAL_SCALE\);/);
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
    expect(script).toMatch(/const turtleWorldMeshes = Object\.values\(itemMeshes \|\| \{\}\)/);
    expect(script).toMatch(/const turtleCameraVisibleCount = turtleWorldMeshes/);
    expect(script).toMatch(/cameraVisible: mesh\.visible !== false,/);
    expect(script).toMatch(/const turtleAuthoritativeItems = Object\.values\(items \|\| \{\}\)/);
    expect(script).toMatch(/turtlesTotal: turtleAuthoritativeItems\.length,/);
    expect(script).toMatch(/turtlesRendered: turtleWorldMeshes\.length,/);
    expect(script).toMatch(/turtlesVisible: turtleCameraVisibleCount,/);
    expect(script).toMatch(/turtlesCameraVisible: turtleCameraVisibleCount,/);
    expect(script).toMatch(/waterColor: ARCADE_ENVIRONMENT\.waterColor,/);
  });

  it("adds boat feel as a visual-only layer without changing gameplay collision root", () => {
    expect(script).toMatch(/createBoatFeelState,/);
    expect(script).toMatch(/BOAT_FEEL_DEFAULTS,/);
    expect(script).toMatch(/installBoatFeelPivot,/);
    expect(script).toMatch(/updateBoatFeel,/);
    expect(script).toMatch(/function captureGameplayCollisionBox\(object3d\)/);
    expect(script).toMatch(/function getPlayerCollisionBox\(\)/);
    expect(script).toMatch(/return playerCollisionBox\.setFromObject\(player\)\.expandByVector\(playerCollisionPadding\);/);
    expect(script).toMatch(/const playerRoot = new THREE\.Group\(\);/);
    expect(script).toMatch(/playerRoot\.name = "localPlayerGameplayRoot";/);
    expect(script).toMatch(/playerRoot\.add\(boat\);/);
    expect(script).toMatch(/captureGameplayCollisionBox\(player\);/);
    expect(script).toMatch(/localBoatFeelState = createBoatFeelState\(\);/);
    expect(script).toMatch(/installBoatFeelPivot\(player, \[boat\]\);/);
    expect(script).toMatch(/disableReflectionForObject\(boat\);/);
    expect(script).toMatch(/try \{ disableReflectionForObject\(group\); \} catch \(_\) \{\}/);
    expect(script).toMatch(/function suppressObjectsDuringWaterReflection\(waterMesh\)/);
    expect(script).toMatch(/suppressObjectsDuringWaterReflection\(water\);/);
    expect(script).toMatch(/target\.userData\.noWaterReflectionApplied = true;/);
    expect(script).not.toMatch(/createBoatWaterlineContact/);
    expect(script).not.toMatch(/localWaterlineContact/);
    expect(script).not.toMatch(/new THREE\.RingGeometry\(0\.39, 0\.53, 48, 1\);/);
    expect(script).toMatch(/isGameplayPrimitiveOverlap\(item\.position, item\.type \|\| "trash", s\)/);
    expect(script).toMatch(/isGameplayPrimitiveOverlap\(item\.position, item\.type, s\)/);
    expect(script).toMatch(/itemMesh\.gameplayScale = s;/);
    expect(script).toMatch(/const meshGameplayScale = Math\.max\(0\.1, Number\(mesh\.gameplayScale\) \|\| Number\(mesh\.scale\?\.x\) \|\| 1\);/);
    expect(script).toMatch(/let collision = isGameplayPrimitiveOverlap\(mesh\.position, mesh\.itemType, meshGameplayScale\);/);
    expect(script).not.toMatch(/playerBox\.intersectsBox\(itemCollisionBox\)/);
    expect(script).toMatch(/clientPosition: \{\s*x: Number\(\(player\.position\?\.x \|\| 0\)\.toFixed\(3\)\),\s*z: Number\(\(player\.position\?\.z \|\| 0\)\.toFixed\(3\)\),\s*rotY: Number\(\(player\.rotation\?\.y \|\| 0\)\.toFixed\(4\)\),\s*\},/);
    expect(script).toMatch(/clientItemPosition: \{\s*x: Number\(/);
    expect(script).toMatch(/latestBoatFeelDebug = updateBoatFeel\(player, localBoatFeelState,/);
    expect(script).toMatch(/updateBoatFeel\(m, m\.userData && m\.userData\.boatFeel,/);
    expect(script).toMatch(/boatFeel: getBoatFeelDebug\(localBoatFeelState\) \|\| latestBoatFeelDebug,/);
    expect(script).not.toMatch(/createWakeRippleEffect/);
    expect(script).not.toMatch(/wakeRippleEffect/);
    expect(script).toMatch(/waterEffects: \{ wakeRipples: false, contactRing: false, engineParticles: ENGINE_WAKE_PARTICLES_ENABLED \},/);
    expect(script).toMatch(/emitters = GAMEPLAY_PARTICLES_ENABLED[\s\S]{0,120}: null;/);
    expect(script).toMatch(/pickups: latestPickupDebug,/);
    expect(script).toMatch(/if \(key === yourId\) \{/);
    expect(script).toMatch(/try \{ disableReflectionForSprite\(sprite\); \} catch \(_\) \{\}/);
    expect(script).toMatch(/const remotePlayerEntriesHumanFirst = remotePlayerEntries[\s\S]{0,180}Number\(isBotPlayerId\(a\)\) - Number\(isBotPlayerId\(b\)\)/);
    expect(script).toMatch(/const authRemoteSamples = Object\.entries\(authStates \|\| \{\}\)/);
    expect(script).toMatch(/const buildRemoteSample = \(\{ id, name, x, y = 0, z, rotY = 0, isBot = false, mesh = null, source \}\) =>/);
    expect(script).toMatch(/visualSuppressed,/);
    expect(script).toMatch(/distanceToLocal:/);
    expect(script).toMatch(/source: "auth",/);
    expect(script).toMatch(/const remotePlayerSamples = \[\.\.\.authRemoteSamples, \.\.\.meshRemoteSamples\]\.slice\(0, 8\);/);
  });

  it("skips optional engine audio on Safari-family WebKit without noisy decode warnings", () => {
    expect(script).toMatch(/const skipEngineAudio = \/AppleWebKit\/i\.test\(ua\) && !\/\(Chrome\|CriOS\|Chromium\|Edg\|OPR\|Firefox\)\/i\.test\(ua\);/);
    expect(script).toContain('audioLoader.loadAsync("/assets/mixkit-motorboat-on-the-sea-1183.m4v")');
    expect(script).not.toContain("Audio load failed; continuing without engine sound");
  });

  it("uses a mobile-aware follow camera without changing the gameplay root", () => {
    expect(script).toMatch(/const FOLLOW_CAMERA_COMPOSITION = Object\.freeze\(\{/);
    expect(script).toMatch(/desktop: \{[\s\S]{0,140}distance: 1\.9,[\s\S]{0,80}height: 1\.12,[\s\S]{0,80}lookHeight: 0\.2,[\s\S]{0,80}lookForward: 0\.52,[\s\S]{0,120}fov: 68,/);
    expect(script).toMatch(/mobile: \{[\s\S]{0,140}distance: 2\.2,[\s\S]{0,80}height: 1\.16,[\s\S]{0,80}lookHeight: 0\.24,[\s\S]{0,80}lookForward: 0\.32,[\s\S]{0,120}fov: 68,/);
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

  it("keeps above-boat powerup and status badges responsive and inspectable", () => {
    expect(script).toMatch(/const BOAT_BADGE_LAYOUT = Object\.freeze\(\{/);
    expect(script).toMatch(/const VISUAL_QA_ENABLED =/);
    expect(script).toMatch(/let visualQaBadgeOverride = null;/);
    expect(script).toMatch(/desktop: \{[\s\S]{0,120}powerupScale: 0\.46,[\s\S]{0,120}statusY: 1\.04,/);
    expect(script).toMatch(/mobile: \{[\s\S]{0,120}powerupScale: 0\.38,[\s\S]{0,120}statusY: 0\.94,/);
    expect(script).toMatch(/function applyBoatBadgeLayout\(\)/);
    expect(script).toMatch(/powerupBadge\.position\.set\(0, layout\.powerupY, 0\);/);
    expect(script).toMatch(/statusBadge\.scale\.set\(layout\.statusScale, layout\.statusScale, 1\);/);
    expect(script).toMatch(/sprite\.userData\.text = text \|\| "";/);
    expect(script).toMatch(/const EMOJI_BADGE_TEXTURE_SIZE = 192;/);
    expect(script).toMatch(/const EMOJI_BADGE_SAFE_WIDTH_RATIO = 0\.62;/);
    expect(script).toMatch(/const EMOJI_BADGE_MIN_FONT_RATIO = 0\.1;/);
    expect(script).toMatch(/const EMOJI_BADGE_COMPACT_MIN_COUNT = 3;/);
    expect(script).toMatch(/canvas\.width = EMOJI_BADGE_TEXTURE_SIZE;/);
    expect(script).toMatch(/function splitBadgeGraphemes\(text\)/);
    expect(script).toMatch(/function compactBadgeText\(text, ctx, maxWidth, fontSize\)/);
    expect(script).toContain("if (/[A-Za-z0-9]/.test(original)) return original;");
    expect(script).toMatch(/const compact = `\$\{first\}\+\$\{graphemes\.length - 1\}`;/);
    expect(script).toMatch(/const maxWidth = size \* EMOJI_BADGE_SAFE_WIDTH_RATIO;/);
    expect(script).toMatch(/while \(fontSize >= minFontSize\)/);
    expect(script).toMatch(/measuredWidth = ctx\.measureText\(displayText\)\.width;/);
    expect(script).toMatch(/displayText = compactBadgeText\(text, ctx, maxWidth, Math\.max\(fontSize, minFontSize\)\);/);
    expect(script).toMatch(/sprite\.userData\.renderedText = displayText;/);
    expect(script).toMatch(/sprite\.userData\.fontSize = fontSize;/);
    expect(script).toMatch(/sprite\.userData\.textWidthRatio = measuredWidth > 0 \? measuredWidth \/ size : 0;/);
    expect(script).toMatch(/function getBadgeDebug\(sprite\)/);
    expect(script).toMatch(/renderedText: String\(sprite\.userData\?\.renderedText \|\| ""\),/);
    expect(script).toMatch(/compacted: !!sprite\.userData\?\.compacted,/);
    expect(script).toMatch(/textWidthRatio: Number\(\(sprite\.userData\?\.textWidthRatio \|\| 0\)\.toFixed\(3\)\),/);
    expect(script).toMatch(/function setVisualQaBadge\(sprite, text\)/);
    expect(script).toMatch(/function refreshVisualQaBadges\(\)/);
    expect(script).toMatch(/if \(!VISUAL_QA_ENABLED \|\| !visualQaBadgeOverride\) return;/);
    expect(script).toMatch(/water\.material\.uniforms\["time"\]\.value \+= ARCADE_ENVIRONMENT\.waterTimeStep;\s*refreshVisualQaBadges\(\);/);
    expect(script).toMatch(/function renderGameToText\(\) \{\s*try \{ ensureBotRosterVisualsForScene\(\); \} catch \(_\) \{\}\s*refreshVisualQaBadges\(\);/);
    expect(script).toMatch(/badges: \{\s*powerup: getBadgeDebug\(powerupBadge\),\s*status: getBadgeDebug\(statusBadge\),\s*\},/);
    expect(script).toMatch(/powerupSamples,/);
    expect(script).toMatch(/window\.__stwlVisualQa = \{/);
    expect(script).toMatch(/visualQaBadgeOverride = \{ powerupText, statusText \};/);
    expect(script).toMatch(/visualQaBadgeOverride = null;/);
    expect(script).toMatch(/showBadges\(\{ powerupText = "⚡🛡️", statusText = "❄️ 3s" \} = \{\}\)/);
    expect(script).toMatch(/applyBoatBadgeLayout\(\);\s*\/\/ lights/);
    expect(script).toMatch(/camera\.updateProjectionMatrix\(\);\s*applyBoatBadgeLayout\(\);/);
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
    expect(script).toMatch(/try \{ disableReflectionForObject\(group\); \} catch \(_\) \{\}/);
    expect(script).toMatch(/environmentPropsVisible: environmentPropStats\.total \|\| 0,/);
  });

  it("renders visible map boundaries and uses soft clamping instead of an invisible wall", () => {
    expect(script).toMatch(/import \{[\s\S]{0,180}boundaryMarkerLayout,[\s\S]{0,140}softClampToWorldBoundary,[\s\S]{0,140}worldBoundaryExtents,[\s\S]{0,140}\} from "\.\/boundaries";/);
    expect(script).toMatch(/let worldBoundaryGroup = null;/);
    expect(script).toMatch(/function createBoundaryRopeSegment\(start, end\)/);
    expect(script).toMatch(/function createWorldBoundaryMarkers\(isMobileViewport\)/);
    expect(script).toMatch(/buoy\.userData\.boundaryMarker = true;/);
    expect(script).toMatch(/rope\.userData\.boundaryRope = true;/);
    expect(script).toMatch(/disableGameplayInteraction\(group\);/);
    expect(script).toMatch(/function rebuildWorldBoundaryMarkers\(\)/);
    expect(script).toMatch(/softClampToWorldBoundary\(player\.position, boundaries/);
    expect(script).toMatch(/playerSpeed \*= WORLD_BOUNDARY_DEFAULTS\.speedDamping;/);
    expect(script).not.toMatch(/player\.position\.copy\(lastPosition\)/);
    expect(script).toMatch(/worldBoundary: worldBoundaryDebug,/);
  });

  it("pins result commentary score to one final game-over score", () => {
    expect(script).toMatch(/function endGame\(endPayload = \{\}\)/);
    expect(script).toMatch(/const finalScore = finalScoreFromEndPayload\(endPayload\);/);
    expect(script).toMatch(/localScore = finalScore;/);
    expect(script).toMatch(/emitGameplayEvent\("game_over", \{[\s\S]{0,160}final_score: finalScore,[\s\S]{0,80}score: finalScore,/);
    expect(script).toMatch(/updateResultsScore\(finalScore\);/);
    expect(script).toMatch(/function waitForAuthoritativeEndPayload\(\)/);
    expect(script).toMatch(/case "game\.end":[\s\S]{0,260}endGame\(body \|\| \{\}\);/);
    expect(script).toMatch(/incomingState === "ENDED"[\s\S]{0,260}waitForAuthoritativeEndPayload\(\)/);
    expect(script).not.toMatch(/endGame\(\{ remaining: 0, timeRemaining: 0 \}\);/);
  });

  it("keeps the visible timer pinned after post-game instead of resetting to duration", () => {
    expect(script).toMatch(/gameState !== "RUNNING" && gameState !== "STARTING" && currentPhase !== "POST_GAME"/);
    expect(script).toMatch(/if \(incomingState === "WAITING"\) \{[\s\S]{0,220}stopLocalTimeTicker\(\);[\s\S]{0,180}if \(currentPhase === "POST_GAME"\) \{[\s\S]{0,120}break;[\s\S]{0,180}if \(Number\.isFinite\(gameDuration\)\) \{/);
  });
});
