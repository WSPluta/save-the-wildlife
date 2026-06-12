import { createTranslator } from "short-uuid";
import * as THREE from "three";
import { MathUtils } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { throttle } from "throttle-debounce";
import { getAssetCacheStats, preloadAssets, preloadNonCriticalAssets, progressivePreload } from "./assets";
import { createEmitters } from "./particles";
import { ObjectPool } from "./objectPool";
import { SpatialOctree } from "./spatialOctree";
import { applyTilt, getHeightAndNormal } from "./buoyancy";
import "./style.css";
import * as lobby from "./lobby";
import { normalizeRoomId } from "./util";

MathUtils.seededRandom(Date.now);

const traceRateInMillis = 50;

const logTrace = throttle(1000, console.log);

let otherPlayers = {};
let otherPlayersMeshes = {};
let items = {};
let itemMeshes = {};
let sendYourPosition;

// Default
let boundaries = { width: 89, height: 23 };

const shortUuidTranslator = createTranslator();

function generatePlayerId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return shortUuidTranslator.fromUUID(globalThis.crypto.randomUUID());
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  const uuid = `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  return shortUuidTranslator.fromUUID(uuid);
}

if (!localStorage.getItem("yourId")) {
  localStorage.setItem("yourId", generatePlayerId());
}
const yourId = localStorage.getItem("yourId");
let playerName;

let renderer, scene, camera, sun, water;
let canvas;
let player, controls;
let emitters = null;
let lastFrameTs = performance.now();
let frameDt = 0;
let smoothedFrameMs = 16.67;
let otherPlayersInfo = {};

// Game flags and UI
let gameOverFlag = false;
let sounds;
let speedElement;

let scoreFromBackend;
let localScore = 0;
let timerId;
let gameDuration;
let serverVersion;
let worker;
let remainingTime;
let timerDivRef = null;
let lastServerTimeSyncAtMs = 0;
let lastServerTimeSyncValue = null;
let localTimeTickerId = null;

let keyboard = {};
let gameState = "WAITING";
let startingIntervalId = null;
let startingTargetTs = null;
let startingRingTotalMs = null;
let startingServerAtMs = null;
const COUNTDOWN_HEIGHT_M = 1.2;
const STARTING_RING_CIRC = 282.743; // 2 * PI * r with r=45
let countdownSprite = null;
let countdownSpriteGoTimeout = null;

let serverAuthEnabled = false;
let serverPhysics = null;
let inputSeq = 0;
let authStates = null;
let authStatesTime = 0;
let startPosition = null;
let cullingDebugEnabled = false;
const cullingHelpers = new Map();
let cullingOctree = null;
let lastCullingNodeCount = 0;
const powerupTmpMatrix = new THREE.Matrix4();
const powerupTmpPos = new THREE.Vector3();
const powerupTmpScale = new THREE.Vector3();
const powerupTmpQuat = new THREE.Quaternion();
const powerupTmpEuler = new THREE.Euler(0, 0, 0);
let wildlifePool = null;
let boatPool = null;
let uiNameTagPool = null;
let trashInstances = null;
let powerupInstances = null;
let environmentPropGroup = null;
let environmentPropStats = { total: 0, buoys: 0, rocks: 0, markers: 0 };
let latestPoolMetrics = null;
let clearTrashInstances = () => {};
let clearPowerupInstances = () => {};
let releaseTrashInstance = () => {};
let releasePowerupInstance = () => {};
let scoreElementRef = null;
let applyPowerUpEffect = () => {};
let triggerReplayMomentCallback = () => {};
const pendingItemCollisions = new Map();
const scoredItemCollisions = new Set();
const COLLISION_PENDING_TIMEOUT_MS = 1500;
const trashTmpMatrix = new THREE.Matrix4();
const trashTmpPos = new THREE.Vector3();
const trashTmpScale = new THREE.Vector3();
const turtleTmpVec3 = new THREE.Vector3();
const turtleTmpVec2 = new THREE.Vector2();
const TURTLE_WATERLINE_OFFSET = -0.045;
const TURTLE_BOB_AMPLITUDE_MIN = 0.006;
const TURTLE_BOB_AMPLITUDE_MAX = 0.018;
const TURTLE_BOB_SPEED_MIN = 0.45;
const TURTLE_BOB_SPEED_MAX = 0.85;
const TURTLE_TURN_RESPONSE = 2.8;
const TURTLE_VERTICAL_LERP = 0.065;
const ARCADE_ENVIRONMENT = Object.freeze({
  toneMappingExposure: 0.6,
  fogColor: 0x7fd4ef,
  fogDensity: 0.0025,
  waterColor: 0x006fb8,
  waterSunColor: 0xcdefff,
  waterDistortionScale: 0.12,
  waterNormalRepeat: 5,
  waterTimeStep: 1.0 / 1800.0,
  skyTurbidity: 6.5,
  skyRayleigh: 1.35,
  skyMieCoefficient: 0.0012,
  skyMieDirectionalG: 0.68,
  sunElevation: 10,
  sunAzimuth: 132,
  ambientColor: 0x5c7180,
  ambientIntensity: 2.2,
  hemisphereSkyColor: 0xc8f2ff,
  hemisphereGroundColor: 0x1a4655,
  hemisphereIntensity: 1.35,
  directionalColor: 0xfff3dc,
  directionalIntensity: 1.1,
  fillColor: 0x86d7ff,
  fillIntensity: 0.55,
});
const ENVIRONMENT_PROP_LIMITS = Object.freeze({
  desktop: 14,
  mobile: 8,
});
function resetTurtleFloatState(object3d) {
  if (!object3d || !object3d.userData) return;
  object3d.userData.floatOffset = Math.random() * Math.PI * 2;
  object3d.userData.floatSpeed = TURTLE_BOB_SPEED_MIN + Math.random() * (TURTLE_BOB_SPEED_MAX - TURTLE_BOB_SPEED_MIN);
  object3d.userData.floatAmplitude = TURTLE_BOB_AMPLITUDE_MIN + Math.random() * (TURTLE_BOB_AMPLITUDE_MAX - TURTLE_BOB_AMPLITUDE_MIN);
}

function makeStaticMaterial(color, options = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    ...options,
  });
}

function disableGameplayInteraction(object3d) {
  object3d.traverse((child) => {
    child.frustumCulled = true;
    child.castShadow = false;
    child.receiveShadow = false;
    child.userData.environmentProp = true;
    child.userData.noCollision = true;
  });
}

function createBuoyProp({ x, z, scale = 1, accent = 0xff5d4d }) {
  const group = new THREE.Group();
  group.position.set(x, 0.08, z);
  group.scale.setScalar(scale);

  const bodyMat = makeStaticMaterial(accent, { emissive: 0x361010, emissiveIntensity: 0.12 });
  const bandMat = makeStaticMaterial(0xf7fbff, { emissive: 0x0c1a1f, emissiveIntensity: 0.05 });
  const capMat = makeStaticMaterial(0x18324b);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.62, 12), bodyMat);
  body.position.y = 0.22;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.285, 0.12, 12), bandMat);
  band.position.y = 0.24;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), capMat);
  top.position.y = 0.62;
  const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), capMat);
  anchor.position.y = 0.74;

  group.add(body, band, top, anchor);
  group.rotation.y = Math.random() * Math.PI * 2;
  disableGameplayInteraction(group);
  return group;
}

function createRockProp({ x, z, scale = 1, color = 0x416b70 }) {
  const group = new THREE.Group();
  group.position.set(x, -0.14, z);
  group.scale.set(scale * 1.6, scale * 0.42, scale);
  const mat = makeStaticMaterial(color, { emissive: 0x071416, emissiveIntensity: 0.12 });
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), mat);
  rock.rotation.set(0.18, Math.random() * Math.PI, -0.08);
  group.add(rock);
  disableGameplayInteraction(group);
  return group;
}

function createMarkerProp({ x, z, scale = 1, color = 0xffc857 }) {
  const group = new THREE.Group();
  group.position.set(x, 0.02, z);
  group.scale.setScalar(scale);
  const mastMat = makeStaticMaterial(0x21495d);
  const flagMat = makeStaticMaterial(color, { emissive: 0x332000, emissiveIntensity: 0.18 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), mastMat);
  mast.position.y = 0.5;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.26, 0.03), flagMat);
  flag.position.set(0.24, 0.82, 0);
  const float = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.22, 10), mastMat);
  float.position.y = 0.05;
  group.add(float, mast, flag);
  group.rotation.y = Math.random() * 0.45 - 0.225;
  disableGameplayInteraction(group);
  return group;
}

function createArcadeEnvironmentProps(isMobileViewport) {
  const group = new THREE.Group();
  group.name = "ArcadeEnvironmentProps";
  group.renderOrder = 1;
  const stats = { total: 0, buoys: 0, rocks: 0, markers: 0 };
  const layout = [
    ["buoys", { x: -24, z: 23, scale: 0.9, accent: 0xff5d4d, mobile: true }],
    ["buoys", { x: 28, z: 28, scale: 0.85, accent: 0xffd047, mobile: true }],
    ["rocks", { x: -42, z: 34, scale: 1.1, color: 0x3f686d, mobile: true }],
    ["rocks", { x: 45, z: 42, scale: 0.95, color: 0x4c7478, mobile: true }],
    ["markers", { x: -15, z: 48, scale: 0.9, color: 0xffc857, mobile: true }],
    ["buoys", { x: 14, z: 58, scale: 0.72, accent: 0x53d2dc, mobile: true }],
    ["markers", { x: 38, z: 78, scale: 0.8, color: 0xff7f50, mobile: true }],
    ["rocks", { x: -30, z: 80, scale: 0.82, color: 0x355d64, mobile: true }],
    ["buoys", { x: -38, z: 66, scale: 0.78, accent: 0xff5d4d }],
    ["markers", { x: 58, z: 110, scale: 0.72, color: 0x8ee3f5 }],
    ["markers", { x: -58, z: 118, scale: 0.72, color: 0xffc857 }],
    ["rocks", { x: 28, z: 104, scale: 0.74, color: 0x2f535b }],
    ["buoys", { x: 0, z: 92, scale: 0.62, accent: 0xffd047 }],
    ["markers", { x: 0, z: 138, scale: 0.68, color: 0xff7f50 }],
  ];
  const limit = isMobileViewport ? ENVIRONMENT_PROP_LIMITS.mobile : ENVIRONMENT_PROP_LIMITS.desktop;
  for (const [kind, cfg] of layout) {
    if (stats.total >= limit) break;
    if (isMobileViewport && !cfg.mobile) continue;
    const prop =
      kind === "buoys" ? createBuoyProp(cfg) :
      kind === "rocks" ? createRockProp(cfg) :
      createMarkerProp(cfg);
    group.add(prop);
    stats[kind] += 1;
    stats.total += 1;
  }
  return { group, stats };
}
const LOD_DISTANCES = {
  high: 50,
  medium: 100,
  low: 200
};
let renderStats = {
  fps: 60,
  frameMs: 16.67,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: null,
};
let lastClientMonitorUpdateAt = 0;
let networkStats = {
  upKbps: 0,
  downKbps: 0,
  rttMs: null,
  quality: "unknown",
  lossRate: 0,
};

// Client-side prediction config
const SNAPSHOT_STALE_MS = 300;

// HUD element references (if present)
const hudTimeEl = document.getElementById("hud-time");
const hudScoreEl = document.getElementById("hud-score");
const hudSpeedEl = document.getElementById("hud-speed");
const hudVersionEl = document.getElementById("hud-version");
const hudPlayersEl = document.getElementById("hud-players");
const hudDebugEl = document.getElementById("hud-debug");
const compactTimeEl = document.getElementById("compact-time");
const compactScoreEl = document.getElementById("compact-score");
const compactSpeedEl = document.getElementById("compact-speed");

// Simple lifecycle state helpers to align button semantics with the flow
// Phases: MAIN_MENU -> LOBBY -> GAMEPLAY -> POST_GAME
let currentPhase = "MAIN_MENU";

const PHASES = {
  ACCESS: "ACCESS",
  MENU: "MENU",
  ADMIN: "ADMIN",
  LOBBY: "LOBBY",
  STARTING: "STARTING",
  GAMEPLAY: "GAMEPLAY",
  ENDED: "ENDED",
  POST_GAME: "POST_GAME",
};

const DEFAULT_ADMIN_ROOM_ID = "ROOM-0001";
const IS_ADMIN_VIEW = (() => {
  try {
    const url = new URL(window.location.href);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return path === "/admin" || url.searchParams.get("admin") === "1";
  } catch (_) {
    return false;
  }
})();

function setPhase(phase) {
  currentPhase = phase;
  try {
    document.body.classList.toggle("phase-gameplay", phase === PHASES.GAMEPLAY);
    document.body.classList.toggle("admin-view", IS_ADMIN_VIEW);
  } catch (_) {}
  renderUI();
  try { if (typeof updateControls === "function") updateControls(); } catch (_) {}
}

function renderUI() {
  const overlay = document.getElementById("overlay");
  if (document.body && document.body.classList) {
    ["MAIN_MENU", ...Object.values(PHASES)].forEach((name) => {
      document.body.classList.remove(`phase-${String(name).toLowerCase()}`);
    });
    document.body.classList.add(`phase-${String(currentPhase).toLowerCase()}`);
    document.body.classList.toggle("admin-view", IS_ADMIN_VIEW);
  }
  const screens = {
    ACCESS: document.getElementById("screen-access"),
    MENU: document.getElementById("screen-menu"),
    ADMIN: document.getElementById("screen-admin"),
    LOBBY: document.getElementById("screen-lobby"),
    STARTING: document.getElementById("screen-starting"),
    POST_GAME: document.getElementById("screen-results"),
  };
  if (overlay) overlay.style.display = (currentPhase === PHASES.GAMEPLAY || currentPhase === PHASES.STARTING) ? "none" : "flex";
  Object.keys(screens).forEach((key) => {
    const el = screens[key];
    if (!el) return;
    const shouldShow = currentPhase === key && key !== "STARTING";
    el.style.display = shouldShow ? "flex" : "none";
    if (el.classList) el.classList.toggle("active", shouldShow);
  });
  // Reflect room code in HUD and Lobby
  updateRoomHud();
  try { renderRoomsDirectory(); } catch (_) {}
  // Manage countdown lifecycle: let server drive the target; only clear when leaving STARTING
  if (currentPhase !== PHASES.STARTING) {
    clearCountdown();
  }
}

 // Countdown helpers
 // 3D countdown sprite above the boat
 const COUNTDOWN_SPRITE_SCALE = { x: 2.5, y: 1.25 };
 
 function createCountdownSprite(initialText) {
   const canvas = document.createElement("canvas");
   canvas.width = 512;
   canvas.height = 256;
   const ctx = canvas.getContext("2d");
   const texture = new THREE.CanvasTexture(canvas);
   texture.minFilter = THREE.LinearFilter;
   const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
   const sprite = new THREE.Sprite(material);
   sprite.userData.canvas = canvas;
   sprite.userData.ctx = ctx;
   // initial draw
   ctx.font = "bold 90px Arial";
   ctx.textAlign = "center";
   ctx.textBaseline = "middle";
   ctx.fillStyle = "white";
   ctx.strokeStyle = "black";
   ctx.lineWidth = 12;
   ctx.clearRect(0, 0, canvas.width, canvas.height);
   ctx.strokeText(initialText || "", canvas.width / 2, canvas.height / 2);
   ctx.fillText(initialText || "", canvas.width / 2, canvas.height / 2);
   texture.needsUpdate = true;
   sprite.scale.set(COUNTDOWN_SPRITE_SCALE.x, COUNTDOWN_SPRITE_SCALE.y, 1);
   try { disableReflectionForSprite(sprite); } catch (_) {}
   return sprite;
 }
 
 function setCountdownText(text) {
   if (!countdownSprite) return;
   try {
     const canvas = countdownSprite.userData.canvas;
     const ctx = countdownSprite.userData.ctx;
     ctx.clearRect(0, 0, canvas.width, canvas.height);
     ctx.font = "bold 90px Arial";
     ctx.textAlign = "center";
     ctx.textBaseline = "middle";
     ctx.fillStyle = "white";
     ctx.strokeStyle = "black";
     ctx.lineWidth = 12;
     ctx.strokeText(text || "", canvas.width / 2, canvas.height / 2);
     ctx.fillText(text || "", canvas.width / 2, canvas.height / 2);
     if (countdownSprite.material && countdownSprite.material.map) {
       countdownSprite.material.map.needsUpdate = true;
     }
   } catch (_) {}
 }
 
 function ensureCountdownSprite() {
   if (countdownSprite) return countdownSprite;
   countdownSprite = createCountdownSprite("");
   try {
     if (player) {
       if (!player.children.includes(countdownSprite)) {
         player.add(countdownSprite);
       }
       countdownSprite.position.set(0, COUNTDOWN_HEIGHT_M, 0);
     } else if (scene) {
       scene.add(countdownSprite);
       countdownSprite.position.set(0, COUNTDOWN_HEIGHT_M, 0);
     }
   } catch (_) {}
   return countdownSprite;
 }
 
 function destroyCountdownSprite() {
   try {
     if (countdownSprite && countdownSprite.parent) {
       countdownSprite.parent.remove(countdownSprite);
     }
     if (countdownSprite && countdownSprite.material && countdownSprite.material.map) {
       countdownSprite.material.map.dispose();
     }
     if (countdownSprite && countdownSprite.material) {
       countdownSprite.material.dispose();
     }
   } catch (_) {}
   countdownSprite = null;
 }
function startCountdownAt(startsAt) {
  clearCountdown();
  startingRingTotalMs = (typeof startsAt === "number" && isFinite(startsAt)) ? Math.max(500, startsAt - Date.now()) : 10000;
  startingTargetTs = (typeof startsAt === "number" && isFinite(startsAt)) ? startsAt : Date.now() + 10000;
  startingServerAtMs = startingTargetTs;
  const update = () => {
    const left = Math.max(0, startingTargetTs - Date.now());
    const secs = Math.max(0, Math.ceil(left / 1000));
    try {
      ensureCountdownSprite();
      if (secs > 0) {
        setCountdownText(String(secs));
      } else {
        setCountdownText("GO");
        if (!countdownSpriteGoTimeout) {
          countdownSpriteGoTimeout = setTimeout(() => {
            destroyCountdownSprite();
          }, 800);
        }
      }
    } catch (_) {}
  };
  update();
  startingIntervalId = setInterval(update, 100);
}
function startCountdown(ms) {
  clearCountdown();
  startingRingTotalMs = Math.max(500, (ms || 10000));
  startingTargetTs = Date.now() + startingRingTotalMs;
  startingServerAtMs = startingTargetTs;
  const update = () => {
    const left = Math.max(0, startingTargetTs - Date.now());
    const secs = Math.max(0, Math.ceil(left / 1000));
    try {
      ensureCountdownSprite();
      if (secs > 0) {
        setCountdownText(String(secs));
      } else {
        setCountdownText("GO");
        if (!countdownSpriteGoTimeout) {
          countdownSpriteGoTimeout = setTimeout(() => {
            destroyCountdownSprite();
          }, 800);
        }
      }
    } catch (_) {}
  };
  update();
  startingIntervalId = setInterval(update, 100);
}
function clearCountdown() {
  if (startingIntervalId) {
    clearInterval(startingIntervalId);
    startingIntervalId = null;
  }
  if (countdownSpriteGoTimeout) {
    try { clearTimeout(countdownSpriteGoTimeout); } catch (_) {}
    countdownSpriteGoTimeout = null;
  }
  destroyCountdownSprite();
  startingServerAtMs = null;
  startingRingTotalMs = null;
}

function showMainMenu() {
  setPhase(IS_ADMIN_VIEW ? "ADMIN" : "ACCESS");
}

function showLobby() {
  setPhase("LOBBY");
}

function showPostGame() {
  setPhase("POST_GAME");
}

function renderTimeValue(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  remainingTime = safe;
  if (hudTimeEl) hudTimeEl.innerHTML = "Time: " + safe;
  if (compactTimeEl) compactTimeEl.innerHTML = "Time: " + safe;
  if (!hudTimeEl && !compactTimeEl && timerDivRef) {
    timerDivRef.innerHTML = "Time: " + safe;
  }
}

function stopLocalTimeTicker() {
  if (localTimeTickerId) {
    clearInterval(localTimeTickerId);
    localTimeTickerId = null;
  }
}

function startLocalTimeTicker() {
  stopLocalTimeTicker();
  localTimeTickerId = setInterval(() => {
    if (gameState !== "RUNNING") return;
    if (!Number.isFinite(lastServerTimeSyncValue)) return;
    const elapsedSec = (Date.now() - lastServerTimeSyncAtMs) / 1000;
    const next = Math.max(0, lastServerTimeSyncValue - elapsedSec);
    renderTimeValue(next);
  }, 200);
}

// Rooms and lifecycle ownership
let roomId = null;
let isAdmin = false;
let roomsDirectory = null;       // { default, rooms[], ts }
let pendingRoomJoinId = null;    // queued join before worker init
let roomJoinedAck = false;       // true after server confirms room.joined
let pendingStartRequested = false; // start requested before room ack
let autoStartMatch = false;      // autostart match when URL flag present

function updateRoomHud() {
  const roomText = "Room: " + (roomId ? roomId : "-");
  const roomEl = document.getElementById("hud-room");
  if (roomEl) roomEl.innerText = roomText;
  const lobbyCode = document.getElementById("lobby-room-code");
  if (lobbyCode) lobbyCode.innerText = roomText;

  // Populate invite link if present
  const inviteInput = document.getElementById("invite-link");
  if (inviteInput) {
    try {
      const nm = playerName || localStorage.getItem("yourName") || "";
      const link =
        (lobby && typeof lobby.buildInviteLink === "function")
          ? lobby.buildInviteLink(roomId, nm)
          : window.location.href;
      inviteInput.value = link;
    } catch (_) {}
  }
  const copyBtn = document.getElementById("invite-copy");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        const val = document.getElementById("invite-link")?.value || window.location.href;
        await navigator.clipboard.writeText(val);
        const prev = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = prev || "Copy Link"; }, 900);
      } catch (_) {}
    };
  }
}

function getConfiguredAdminRoom() {
  const input = document.getElementById("admin-room-input");
  const fromInput = input && input.value ? input.value : "";
  const normalized =
    normalizeRoomId(fromInput) ||
    normalizeRoomId(roomId) ||
    normalizeRoomId(DEFAULT_ADMIN_ROOM_ID);
  return normalized || DEFAULT_ADMIN_ROOM_ID;
}

function getConfiguredAdminToken() {
  const input = document.getElementById("admin-token-input");
  return input && input.value ? String(input.value).trim() : "";
}

function setAdminStatus(text, stateText) {
  const status = document.getElementById("admin-status");
  if (status && text) status.textContent = text;
  const state = document.getElementById("admin-state");
  if (state && stateText) state.textContent = stateText;
}

function syncAdminRoomUi(nextRoom) {
  const normalized = normalizeRoomId(nextRoom) || DEFAULT_ADMIN_ROOM_ID;
  roomId = normalized;
  const input = document.getElementById("admin-room-input");
  if (input && input.value !== normalized) input.value = normalized;
  const label = document.getElementById("admin-room-label");
  if (label) label.textContent = "Room: " + normalized;
  updateRoomHud();
  return normalized;
}

async function enterWaitingLobby() {
  if (IS_ADMIN_VIEW) {
    setPhase("ADMIN");
    return;
  }
  if (!gameInitialized) await init();
  try {
    const wanted = normalizeRoomId(roomId) || normalizeRoomId(roomsDirectory && roomsDirectory.default) || null;
    if (worker) worker.postMessage({ type: "room.join", body: wanted ? { id: wanted } : {} });
  } catch (_) {}
  setPhase("LOBBY");
}

async function enterAdminConsole() {
  if (!IS_ADMIN_VIEW) return;
  const room = syncAdminRoomUi(getConfiguredAdminRoom());
  playerName = localStorage.getItem("yourName") || "Presenter";
  setPhase("ADMIN");
  if (!gameInitialized) await init();
  try {
    if (worker) worker.postMessage({ type: "room.join", body: { id: room } });
  } catch (_) {}
  setAdminStatus("Connected to " + room + ".", "Waiting");
}

async function requestPresenterStart() {
  const room = syncAdminRoomUi(getConfiguredAdminRoom());
  if (!gameInitialized) await init();
  try {
    if (worker) worker.postMessage({ type: "room.join", body: { id: room } });
    setAdminStatus("Starting " + room + "...", "Starting");
    worker.postMessage({
      type: "admin.presenter.start",
      body: { room, token: getConfiguredAdminToken() },
    });
  } catch (_) {
    setAdminStatus("Start failed.", "Error");
  }
}

async function requestPresenterEnd() {
  const room = syncAdminRoomUi(getConfiguredAdminRoom());
  if (!gameInitialized) await init();
  try {
    if (worker) worker.postMessage({ type: "room.join", body: { id: room } });
    setAdminStatus("Ending " + room + "...", "Ending");
    worker.postMessage({
      type: "admin.presenter.end",
      body: { room, token: getConfiguredAdminToken() },
    });
  } catch (_) {
    setAdminStatus("End failed.", "Error");
  }
}

function requestAutoStartMatch() {
  try {
    if (!worker) return;
    const room = normalizeRoomId(roomId) || DEFAULT_ADMIN_ROOM_ID;
    worker.postMessage({
      type: "admin.presenter.start",
      body: { room },
    });
  } catch (_) {}
}

async function copyAdminPlayerLink() {
  const room = syncAdminRoomUi(getConfiguredAdminRoom());
  try {
    const url = new URL(window.location.href);
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("room", room);
    await navigator.clipboard.writeText(url.toString());
    setAdminStatus("Player link copied for " + room + ".", "Waiting");
  } catch (_) {
    setAdminStatus("Could not copy player link.", "Waiting");
  }
}


// Render rooms directory if containers exist
function renderRoomsDirectory() {
  if (!roomsDirectory || typeof roomsDirectory !== "object") return;
  // Default label
  const defEl = document.getElementById("rooms-default");
  if (defEl) {
    if (roomsDirectory.default) {
      defEl.textContent = "Default: " + roomsDirectory.default;
      defEl.style.display = "";
    } else {
      defEl.textContent = "";
      defEl.style.display = "none";
    }
  }
  // Rooms list
  const listEl = document.getElementById("rooms-list");
  if (listEl) {
    listEl.innerHTML = "";
    // Sort: default first, then by humans desc, then id asc
    const sorted = (roomsDirectory.rooms || []).slice().sort((a, b) => {
      if ((b.default ? 1 : 0) !== (a.default ? 1 : 0)) return (b.default ? 1 : 0) - (a.default ? 1 : 0);
      if ((b.humans || 0) !== (a.humans || 0)) return (b.humans || 0) - (a.humans || 0);
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
    sorted.forEach((r) => {
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "center";
      li.style.justifyContent = "space-between";
      li.style.gap = "8px";
      const label = document.createElement("span");
      label.textContent = `${r.id} ${r.default ? "(default)" : ""} — ${r.state || "WAITING"} — ${r.humans ?? 0} players`;
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Join";
      btn.onclick = () => {
        const wanted = normalizeRoomId(r.id);
        if (!wanted) return;
        // If worker is live, request join. Otherwise queue and init.
        if (worker) {
          try { worker.postMessage({ type: "room.join", body: { id: wanted } }); } catch (_) {}
        } else {
          pendingRoomJoinId = wanted;
          if (!gameInitialized) {
            // Initialize networking which also assigns default room on connect
            init();
          }
        }
      };
      li.appendChild(label);
      li.appendChild(btn);
      listEl.appendChild(li);
    });
  }
}

function setRoomAndBroadcast(newRoom, owner = false) {
  const normalized = normalizeRoomId(newRoom);
  roomId = normalized; // optimistic local update; server will ack via room.joined
  // admin is assigned by server; clear local flag until room.admin arrives
  isAdmin = false;
  roomJoinedAck = false;
  updateRoomHud();
  // If comms worker already running, request join and update name
  try {
    const name = playerName || localStorage.getItem("yourName") || "Default";
    if (worker) {
      // Primary: explicit room.join (omit id when leaving/default)
      const body = normalized ? { id: normalized } : {};
      worker.postMessage({ type: "room.join", body });
      // Back-compat: persist latest name; room param is optional now
      worker.postMessage({ type: "player.info.joining", body: { id: yourId, name } });
    } else {
      // Queue desired room to be joined right after init()
      pendingRoomJoinId = normalized || null;
    }
  } catch (_) {}
}

// Enable/disable lifecycle buttons based on phase and ownership
function updateControls() {
  const menuBtn = document.getElementById("btn-main-menu");
  const createBtn = document.getElementById("btn-create-room");
  const joinBtn = document.getElementById("btn-join-room");
  const startBtn = document.getElementById("btn-start-match");
  const endBtn = document.getElementById("btn-end-match");
  const restartBtn = document.getElementById("btn-restart-match");
  const grantBtn = document.getElementById("btn-grant-admin");

  const inMain = currentPhase === "MENU" || currentPhase === "MAIN_MENU";
  const inLobby = currentPhase === "LOBBY";
  const inPlay = currentPhase === "GAMEPLAY";
  const inPost = currentPhase === "POST_GAME";

  if (menuBtn) menuBtn.disabled = false;
  const canStartNow = inLobby;
  const canStartEffective = canStartNow;
  if (createBtn) createBtn.disabled = inPlay || currentPhase === "STARTING";          // cannot create while playing or during countdown
  if (joinBtn) joinBtn.disabled = inPlay || currentPhase === "STARTING";              // cannot join while playing or during countdown
  if (startBtn) startBtn.disabled = !canStartEffective;
  if (endBtn) endBtn.disabled = !(inPlay && isAdmin);
  if (restartBtn) restartBtn.disabled = !((inPlay || inPost) && isAdmin);
  if (grantBtn) grantBtn.disabled = !isAdmin;
}

// Tron-like trail settings and state
let trails = {};
const TRAIL_POINT_DISTANCE = 0.5;
const MAX_TRAIL_POINTS = 11;
const TRAIL_COLLISION_RADIUS = 0.6;
const TRAIL_TTL_MS = 5000; // remove trail if no new points for 5s
let freezeUntilMs = 0;
let freezeDiv = null;
let powerupBadge = null;
let statusBadge = null;

// Power-up runtime state
const powerUpState = {
  speedMultiplier: 1,
  shield: false,
  magnetUntil: 0,
  freezeUntil: 0,
  timers: {},
  uiDiv: null,
};
const POWERUP_MAGNET_RADIUS = 3.6;
const POWERUP_FREEZE_OTHER_MULT = 0.45;

lobby.getLeaderBoard();

let gameInitialized = false;
let clientGameStarted = false;
let uiBound = false;
let currentSessionId = null;
let lastPositionEventAt = 0;
let eventStats = {
  trash_collected: 0,
  marine_hit: 0,
  powerup_collected: 0,
  trail_crossed: 0,
  player_frozen: 0,
};
let mobileInput = { throttle: 0, steer: 0, active: false };
const MOBILE_THROTTLE_AXIS = -1;
const MOBILE_STEER_AXIS = -1;

function resetGameplayTelemetry() {
  currentSessionId = `${roomId || "ROOM"}:${yourId}:${Date.now()}`;
  lastPositionEventAt = 0;
  pendingItemCollisions.clear();
  scoredItemCollisions.clear();
  eventStats = {
    trash_collected: 0,
    marine_hit: 0,
    powerup_collected: 0,
    trail_crossed: 0,
    player_frozen: 0,
  };
}

function currentPlayerPosition() {
  return player
    ? { x: Number(player.position.x || 0), y: Number(player.position.y || 0), z: Number(player.position.z || 0) }
    : null;
}

function emitGameplayEvent(type, metadata = {}) {
  try {
    if (!worker || !type) return;
    const payload = {
      type,
      session_id: currentSessionId || `${roomId || "ROOM"}:${yourId}:pending`,
      room_id: roomId || null,
      player_id: yourId,
      player_name: playerName || localStorage.getItem("yourName") || "Default",
      score: Number(localScore || 0),
      position: metadata.position || currentPlayerPosition(),
      occurred_at: new Date().toISOString(),
      related_player_id: metadata.related_player_id || metadata.relatedPlayerId || null,
      related_item_id: metadata.related_item_id || metadata.relatedItemId || metadata.itemId || null,
      powerup_type: metadata.powerup_type || metadata.powerupType || null,
      metadata,
    };
    worker.postMessage({ type: "game.event", body: payload });
  } catch (_) {}
}

function normalizeItemDestroyPayload(payload) {
  if (payload && typeof payload === "object") {
    const id = payload.id || payload.itemId;
    return {
      ...payload,
      id,
      itemId: id,
      itemType: payload.itemType || payload.type || payload.powerupType || null,
    };
  }
  return { id: payload, itemId: payload, itemType: null };
}

function markItemCollisionPending(itemId, itemType) {
  if (!itemId) return false;
  const now = Date.now();
  const existing = pendingItemCollisions.get(itemId);
  if (existing && now - existing.at < COLLISION_PENDING_TIMEOUT_MS) return false;
  pendingItemCollisions.set(itemId, { at: now, itemType });
  return true;
}

function clearStalePendingItemCollisions(now = Date.now()) {
  for (const [itemId, entry] of pendingItemCollisions.entries()) {
    if (!entry || now - entry.at > COLLISION_PENDING_TIMEOUT_MS) {
      pendingItemCollisions.delete(itemId);
    }
  }
}

function updateLocalScoreDisplays() {
  const text = "Score: " + localScore;
  if (scoreElementRef) scoreElementRef.innerHTML = text;
  if (hudScoreEl) hudScoreEl.innerHTML = text;
  if (compactScoreEl) compactScoreEl.innerHTML = text;
}

function itemPositionFromEvidence(itemId, payload = {}) {
  const p = payload.position || items[itemId]?.position || itemMeshes[itemId]?.position || null;
  return p
    ? { x: Number(p.x || 0), y: Number(p.y || 0), z: Number(p.z || 0) }
    : currentPlayerPosition();
}

function removeItemFromScene(itemId) {
  if (!itemId) return;
  const item = items[itemId];
  const mesh = itemMeshes[itemId];
  const itemType = item?.type || mesh?.itemType || "";

  if (item && isPowerUp(item.type)) {
    releasePowerupInstance(itemId);
  } else if (item && !isMarineLife(item.type) && !isPowerUp(item.type)) {
    releaseTrashInstance(itemId);
  } else if (mesh && isMarineLife(mesh.itemType)) {
    returnToPool(mesh);
  }

  if (mesh && mesh.isObject3D) {
    try { scene.remove(mesh); } catch (_) {}
  }
  if (!item && String(itemType || "").startsWith("powerup_")) {
    releasePowerupInstance(itemId);
  } else if (!item && itemType && !isMarineLife(itemType) && !isPowerUp(itemType)) {
    releaseTrashInstance(itemId);
  }
  delete items[itemId];
  delete itemMeshes[itemId];
}

function applyConfirmedCollisionOutcome(rawPayload) {
  const payload = normalizeItemDestroyPayload(rawPayload);
  const itemId = payload.itemId || payload.id;
  if (!itemId) return;
  const pending = pendingItemCollisions.get(itemId);
  pendingItemCollisions.delete(itemId);

  const actorId = payload.playerId || payload.player_id || null;
  if (actorId && actorId !== yourId) return;
  if (!actorId && !pending) return;
  if (scoredItemCollisions.has(itemId)) return;

  const itemType =
    payload.itemType ||
    payload.powerupType ||
    pending?.itemType ||
    items[itemId]?.type ||
    itemMeshes[itemId]?.itemType ||
    "";
  const position = itemPositionFromEvidence(itemId, payload);

  if (isPowerUp(itemType)) {
    applyPowerUpEffect(itemType);
    eventStats.powerup_collected++;
    emitGameplayEvent("powerup_collected", {
      itemId,
      related_item_id: itemId,
      powerup_type: itemType,
      item_type: itemType,
      item_position: position,
    });
    try {
      triggerReplayMomentCallback("powerup_collected", {
        itemId,
        powerupType: itemType,
        worldPos: position,
      });
    } catch (_) {}
  } else if (isMarineLife(itemType)) {
    const delta = Number.isFinite(payload.scoreDelta) ? Number(payload.scoreDelta) : -1;
    if (delta !== 0) {
      localScore += delta;
      eventStats.marine_hit++;
      emitGameplayEvent("marine_hit", {
        itemId,
        related_item_id: itemId,
        item_type: itemType,
        item_position: position,
      });
      try {
        triggerReplayMomentCallback("marine_hit", {
          itemId,
          itemType,
          worldPos: position,
        });
      } catch (_) {}
    }
  } else {
    const delta = Number.isFinite(payload.scoreDelta) ? Number(payload.scoreDelta) : 1;
    localScore += delta;
    eventStats.trash_collected++;
    emitGameplayEvent("trash_collected", {
      itemId,
      related_item_id: itemId,
      item_type: itemType || "trash",
      item_position: position,
    });
    try {
      triggerReplayMomentCallback("trash_collect", {
        itemId,
        worldPos: position,
      });
    } catch (_) {}
  }

  scoredItemCollisions.add(itemId);
  updateLocalScoreDisplays();
}

// Helper: request a match start on the current room with retries if server ack is slow
function requestMatchStart() {
  try {
    if (!worker) return;
    const statusEl = document.getElementById("lobby-status");

    // Ensure we are attached to the intended room before starting
    if (!roomId) {
      try { worker.postMessage({ type: "room.join", body: {} }); } catch (_) {}
      pendingStartRequested = true;
      if (statusEl) statusEl.textContent = "Joining default room…";
      return;
    }
    if (!roomJoinedAck) {
      try { worker.postMessage({ type: "room.join", body: { id: roomId } }); } catch (_) {}
      pendingStartRequested = true;
      if (statusEl) statusEl.textContent = "Joining room " + roomId + "…";
      return;
    }

    // Ensure latest identity stored on server (helps admin assignment on first join)
    const nameNow = playerName || localStorage.getItem("yourName") || "Default";
    try { worker.postMessage({ type: "player.info.joining", body: { id: yourId, name: nameNow } }); } catch (_) {}

    // Register and request start; server will emit 'startingGame' and 'game.state'
    if (statusEl) statusEl.textContent = "Starting match…";
    worker.postMessage({ type: "game.start", body: { playerId: yourId, playerName: nameNow } });
    worker.postMessage({ type: "admin.start" });

    // If the server didn't flip us to STARTING soon, retry admin.start once
    setTimeout(() => {
      try {
        if (currentPhase !== "STARTING") {
          worker.postMessage({ type: "admin.start" });
        }
      } catch (_) {}
    }, 900);
  } catch (_) {}
}

function setupTouchJoystick() {
  if (document.getElementById("touch-joystick")) return;
  const wrap = document.createElement("div");
  wrap.id = "touch-joystick";
  wrap.className = "touch-joystick";
  wrap.setAttribute("aria-label", "Touch steering control");
  const knob = document.createElement("div");
  knob.className = "touch-joystick-knob";
  wrap.appendChild(knob);
  document.body.appendChild(wrap);

  const reset = () => {
    mobileInput = { throttle: 0, steer: 0, active: false };
    wrap.classList.remove("active");
    knob.style.transform = "translate(-50%, -50%)";
  };

  const update = (clientX, clientY) => {
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    const dx = Math.max(-radius, Math.min(radius, clientX - cx));
    const dy = Math.max(-radius, Math.min(radius, clientY - cy));
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius && distance > 0 ? radius / distance : 1;
    const x = dx * scale;
    const y = dy * scale;
    mobileInput = {
      throttle: Math.max(-1, Math.min(1, MOBILE_THROTTLE_AXIS * -y / radius)),
      steer: Math.max(-1, Math.min(1, MOBILE_STEER_AXIS * x / radius)),
      active: true,
    };
    wrap.classList.add("active");
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  };

  wrap.addEventListener("pointerdown", (event) => {
    try { wrap.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
    update(event.clientX, event.clientY);
  });
  wrap.addEventListener("pointermove", (event) => {
    if (!mobileInput.active) return;
    event.preventDefault();
    update(event.clientX, event.clientY);
  });
  wrap.addEventListener("pointerup", reset);
  wrap.addEventListener("pointercancel", reset);
}

function bindGlobalUI() {
  if (uiBound) return;
  uiBound = true;
  setupTouchJoystick();

  // Main Menu "Play" continues into initialization (Access -> Main Menu -> Lobby)
  const playStartBtn = document.getElementById("startButton");
  if (playStartBtn) {
    // Prefill with previously saved name if available
    const nameInput = document.querySelector('#input input[name="name"]');
    if (nameInput) {
      const prev = localStorage.getItem("yourName");
      if (prev) nameInput.value = prev;
    }
    playStartBtn.addEventListener("click", () => {
      const inputEl = document.querySelector('#input input[name="name"]');
      const name =
        (inputEl && inputEl.value && inputEl.value.trim()) ||
        localStorage.getItem("yourName") ||
        "Default";
      playerName = name;
      localStorage.setItem("yourName", name);
      enterWaitingLobby();
    });
  }

  // Distinct lifecycle controls in HUD
  const menuBtn = document.getElementById("btn-main-menu");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      // Cancel any pending start and optionally end if admin
      pendingStartRequested = false;
      try { if (isAdmin && worker && (currentPhase === "STARTING" || currentPhase === "GAMEPLAY")) worker.postMessage({ type: "admin.end" }); } catch (_) {}
      // Fully detach networking so server events cannot pull us back
      try { if (worker) worker.postMessage({ type: "close" }); } catch (_) {}
      try { if (worker && typeof worker.terminate === "function") worker.terminate(); } catch (_) {}
      worker = null;
      // Reset room/admin flags
      roomId = null;
      roomJoinedAck = false;
      isAdmin = false;
      gameState = "WAITING";
      clearCountdown();
      setRoomAndBroadcast(null, false);
      showMainMenu();
    });
  }

  const createRoomBtn = document.getElementById("btn-create-room");
  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", async () => {
      // Generate a short room code (owner becomes host)
      const code = (short() || "").substring(0, 6);
      if (!gameInitialized) await init();
      setRoomAndBroadcast(code, true);
      showLobby();
    });
  }

  const joinRoomBtn = document.getElementById("btn-join-room");
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", async () => {
      const code = window.prompt("Enter room code to join:");
      if (!code) return;
      if (!gameInitialized) await init();
      setRoomAndBroadcast(code, false);
      showLobby();
    });
  }

  const startMatchBtn = document.getElementById("btn-start-match");
  if (startMatchBtn) {
    startMatchBtn.addEventListener("click", async () => {
      if (!gameInitialized) await init();
      try {
        if (worker) { try { worker.postMessage({ type: "admin.claim" }); } catch (_) {} }
        requestMatchStart();
        // Countdown and state changes will arrive via server events (startingGame/game.state)
      } catch (_) {}
    });
  }

  const endMatchBtn = document.getElementById("btn-end-match");
  if (endMatchBtn) {
    endMatchBtn.addEventListener("click", async () => {
      // Only admin can end during STARTING/GAMEPLAY
      if (!isAdmin || (currentPhase !== "GAMEPLAY" && currentPhase !== "STARTING")) return;
      if (!gameInitialized) await init();
      try {
        if (worker) worker.postMessage({ type: "admin.end" });
        setPhase("POST_GAME");
      } catch (_) {}
    });
  }

  const restartBtnTop = document.getElementById("btn-restart-match");
  if (restartBtnTop) {
    restartBtnTop.addEventListener("click", async () => {
      // Only admin can restart from GAMEPLAY or POST_GAME
      if (!isAdmin || (currentPhase !== "GAMEPLAY" && currentPhase !== "POST_GAME")) return;
      if (!gameInitialized) await init();
      try {
        if (worker) {
          worker.postMessage({ type: "admin.end" });
          setTimeout(() => {
            try {
              worker.postMessage({ type: "game.start", body: { playerId: yourId, playerName } });
              worker.postMessage({ type: "admin.start" });
            } catch (_) {}
          }, 1200);
        }
      } catch (_) {}
    });
  }

  // Screens buttons wiring
  const accessContinueBtn = document.getElementById("btn-access-continue");
  if (accessContinueBtn) {
    accessContinueBtn.addEventListener("click", async () => {
      const inputEl = document.getElementById("name-input");
      const name = (inputEl && inputEl.value && inputEl.value.trim()) || localStorage.getItem("yourName") || "Default";
      playerName = name;
      localStorage.setItem("yourName", name);
      await enterWaitingLobby();
    });
  }
  const quickMatchBtn = document.getElementById("btn-quick-match");
  if (quickMatchBtn) {
    quickMatchBtn.addEventListener("click", async () => {
      if (!gameInitialized) await init();
      try {
        const def = (roomsDirectory && roomsDirectory.default) ? roomsDirectory.default : null;
        if (def) {
          setRoomAndBroadcast(def, false);
        } else {
          if (worker) worker.postMessage({ type: "room.join", body: {} });
        }
      } catch (_) {}
      setPhase("LOBBY");
    });
  }
  const createRoomMenuBtn = document.getElementById("btn-create-room-menu");
  if (createRoomMenuBtn) {
    createRoomMenuBtn.addEventListener("click", async () => {
      const code = (short() || "").substring(0, 6);
      if (!gameInitialized) await init();
      setRoomAndBroadcast(code, true);
      setPhase("LOBBY");
    });
  }
  const joinRoomMenuBtn = document.getElementById("btn-join-room-menu");
  if (joinRoomMenuBtn) {
    joinRoomMenuBtn.addEventListener("click", async () => {
      const code = window.prompt("Enter room code to join:");
      if (!code) return;
      if (!gameInitialized) await init();
      setRoomAndBroadcast(code, false);
      setPhase("LOBBY");
    });
  }
  const exitToAccessBtn = document.getElementById("btn-exit-to-access");
  if (exitToAccessBtn) {
    exitToAccessBtn.addEventListener("click", () => setPhase("ACCESS"));
  }
  const lobbyLeaveBtn = document.getElementById("btn-lobby-leave");
  if (lobbyLeaveBtn) {
    lobbyLeaveBtn.addEventListener("click", () => {
      // Cancel any pending start; end match if you are admin and countdown already started
      pendingStartRequested = false;
      try { if (isAdmin && worker && (currentPhase === "STARTING" || currentPhase === "GAMEPLAY")) worker.postMessage({ type: "admin.end" }); } catch (_) {}
      // Fully detach networking so server events cannot pull us back
      try { if (worker) worker.postMessage({ type: "close" }); } catch (_) {}
      try { if (worker && typeof worker.terminate === "function") worker.terminate(); } catch (_) {}
      worker = null;
      // Reset room/admin flags
      roomId = null;
      roomJoinedAck = false;
      isAdmin = false;
      gameState = "WAITING";
      clearCountdown();
      setRoomAndBroadcast(null, false);
      setPhase("ACCESS");
    });
  }
  const chatSendBtn = document.getElementById("chat-send");
  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", async () => {
      const input = document.getElementById("chat-text");
      const text = (input && input.value) ? String(input.value).slice(0, 300) : "";
      if (!text) return;
      if (!gameInitialized) await init();
      try { if (worker) worker.postMessage({ type: "chat.send", body: { text } }); } catch (_) {}
      if (input) input.value = "";
    });
  }
  const chatText = document.getElementById("chat-text");
  if (chatText) {
    chatText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = String(chatText.value || "").slice(0, 300).trim();
        if (val) {
          if (!worker && !gameInitialized) { try { init(); } catch (_) {} }
          try { if (worker) worker.postMessage({ type: "chat.send", body: { text: val } }); } catch (_) {}
          chatText.value = "";
        }
      }
    });
  }
  // Results screen actions
  const rematchBtn = document.getElementById("btn-results-rematch");
  if (rematchBtn) {
    rematchBtn.addEventListener("click", async () => {
      await enterWaitingLobby();
    });
  }
  const resultsMenuBtn = document.getElementById("btn-results-menu");
  if (resultsMenuBtn) {
    resultsMenuBtn.addEventListener("click", () => {
      setPhase("ACCESS");
    });
  }

  const adminRoomInput = document.getElementById("admin-room-input");
  if (adminRoomInput) {
    adminRoomInput.addEventListener("change", () => {
      const room = syncAdminRoomUi(adminRoomInput.value);
      try { if (worker) worker.postMessage({ type: "room.join", body: { id: room } }); } catch (_) {}
    });
  }
  const adminStartBtn = document.getElementById("btn-admin-start");
  if (adminStartBtn) {
    adminStartBtn.addEventListener("click", requestPresenterStart);
  }
  const adminEndBtn = document.getElementById("btn-admin-end");
  if (adminEndBtn) {
    adminEndBtn.addEventListener("click", requestPresenterEnd);
  }
  const adminCopyBtn = document.getElementById("btn-admin-copy-link");
  if (adminCopyBtn) {
    adminCopyBtn.addEventListener("click", copyAdminPlayerLink);
  }

  // Options button: open a simple modal (non-invasive, prod-safe)
  const optionsBtn = document.getElementById("btn-options");
  if (optionsBtn) {
    optionsBtn.addEventListener("click", () => {
      try { ensureOptionsPanel(); } catch (_) {}
      const modal = document.getElementById("options-modal");
      if (modal) modal.style.display = "flex";
    });
  }
  // Debug toggle button (for Chrome/desktop without function keys)
  const toggleDebugBtn = document.getElementById("btn-toggle-debug");
  if (toggleDebugBtn) {
    toggleDebugBtn.addEventListener("click", () => {
      try { toggleHudDebug(); } catch (_) {}
    });
  }
  const grantBtn = document.getElementById("btn-grant-admin");
  if (grantBtn) {
    grantBtn.addEventListener("click", () => {
      if (!isAdmin) return;
      const target = window.prompt("Enter player ID to grant admin:");
      if (!target) return;
      try { if (worker) worker.postMessage({ type: "admin.grant", body: { id: String(target).trim() } }); } catch (_) {}
    });
  }

  // Debug Object Monitor admin controls
  const applyBtn = document.getElementById("mon-apply");
  if (applyBtn) {
    applyBtn.onclick = () => {
      const modeSel = document.getElementById("mon-mode-select");
      const mode = modeSel ? modeSel.value : "proportional";
      const k = parseFloat((document.getElementById("mon-k")?.value) || "1");
      const tr = parseFloat((document.getElementById("mon-tr")?.value) || "1");
      const mr = parseFloat((document.getElementById("mon-mr")?.value) || "2");
      const pr = parseFloat((document.getElementById("mon-pr")?.value) || "0.2");
      if (worker) worker.postMessage({ type: "admin.spawnMode.set", body: { mode, params: { k, tr, mr, pr } } });
    };
  }
  const applyWorldBtn = document.getElementById("mon-apply-world");
  if (applyWorldBtn) {
    applyWorldBtn.onclick = () => {
      const minX = parseInt((document.getElementById("mon-minx")?.value) || "44");
      const minZ = parseInt((document.getElementById("mon-minz")?.value) || "11");
      const maxX = parseInt((document.getElementById("mon-maxx")?.value) || "176");
      const maxZ = parseInt((document.getElementById("mon-maxz")?.value) || "88");
      if (worker) worker.postMessage({ type: "admin.worldScaling.set", body: { minX, minZ, maxX, maxZ } });
    };
  }
}
function ensureOptionsPanel() {
  if (document.getElementById("options-modal")) return;
  const modal = document.createElement("div");
  modal.id = "options-modal";
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.display = "none";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.zIndex = "1200";
  modal.style.background = "rgba(0,0,0,0.45)";
  const panel = document.createElement("div");
  panel.style.minWidth = "280px";
  panel.style.maxWidth = "90vw";
  panel.style.background = "rgba(12,33,54,0.75)";
  panel.style.border = "1px solid rgba(255,255,255,0.15)";
  panel.style.backdropFilter = "blur(8px)";
  panel.style.borderRadius = "12px";
  panel.style.padding = "14px";
  panel.style.color = "#eaf6fb";
  panel.innerHTML = `
    <h3 style="margin: 0 0 8px 0;">Options</h3>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <label style="display:flex;align-items:center;gap:8px;"><input id="opt-sound" type="checkbox" checked /> Sound</label>
      <label>
        Graphics:
        <select id="opt-gfx">
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
        <button id="opt-close" class="btn">Close</button>
      </div>
    </div>
  `;
  modal.appendChild(panel);
  document.body.appendChild(modal);

  const optSound = panel.querySelector("#opt-sound");
  const optGfx = panel.querySelector("#opt-gfx");
  const savedSound = localStorage.getItem("opt.sound");
  if (savedSound != null) optSound.checked = savedSound === "1";
  const savedGfx = localStorage.getItem("opt.gfx");
  if (savedGfx) optGfx.value = savedGfx;

  optSound.addEventListener("change", () => localStorage.setItem("opt.sound", optSound.checked ? "1" : "0"));
  optGfx.addEventListener("change", () => localStorage.setItem("opt.gfx", optGfx.value));

  panel.querySelector("#opt-close").addEventListener("click", () => { modal.style.display = "none"; });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });
}
 // Bind as soon as DOM is ready; also try immediately in case this runs late
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", bindGlobalUI);
} else {
  bindGlobalUI();
}
// Optional dev autostart behind URL flag (?autostart=1)
try {
  const url = new URL(window.location.href);
  if (!IS_ADMIN_VIEW && url.searchParams.get("autostart") === "1") {
    autoStartMatch = true;
    setTimeout(() => { if (!gameInitialized) init(); }, 100);
  }
} catch (_) {}
// Set initial phase based on stored name (no flicker)
(function initialPhase() {
  if (IS_ADMIN_VIEW) {
    setPhase("ADMIN");
    setTimeout(() => { enterAdminConsole(); }, 100);
    return;
  }
  const saved = localStorage.getItem("yourName");
  if (saved) {
    playerName = saved;
    setPhase("LOBBY");
    setTimeout(() => { enterWaitingLobby(); }, 100);
  } else {
    setPhase("ACCESS");
  }
})();

// URL deep-link: ?room=CODE&name=YourName
(function applyDeepLink() {
  try {
    const url = new URL(window.location.href);
    const roomParam = url.searchParams.get("room");
    const nameParam = url.searchParams.get("name");
    if (IS_ADMIN_VIEW) {
      if (roomParam && roomParam.trim()) {
        syncAdminRoomUi(roomParam);
      } else {
        syncAdminRoomUi(DEFAULT_ADMIN_ROOM_ID);
      }
      return;
    }
    if (nameParam && nameParam.trim()) {
      localStorage.setItem("yourName", nameParam.trim());
      playerName = nameParam.trim();
      if (currentPhase === "ACCESS") {
        setPhase("LOBBY");
      }
    }
    if (roomParam && roomParam.trim()) {
      const desired = normalizeRoomId(roomParam);
      if (desired) {
        setRoomAndBroadcast(desired, false);
        if (playerName || localStorage.getItem("yourName")) {
          setPhase("LOBBY");
          if (!gameInitialized) { init(); }
        } else {
          setPhase("ACCESS");
        }
      }
    }
  } catch (_) {}
})();

/* Debug HUD toggle support (F2), button, and ?debug=1 */
function applyHudMode() {
  const stored = localStorage.getItem("debugHUD");
  if (stored === null) localStorage.setItem("debugHUD", "0");
  const debugOn = (stored === null) ? false : stored === "1";
  const full = document.getElementById("hud");
  const compact = document.getElementById("hud-compact");
  const monitor = document.getElementById("monitor-panel");
  if (full) full.style.display = debugOn ? "flex" : "none";
  if (compact) compact.style.display = debugOn ? "none" : "flex";
  if (monitor) monitor.style.display = debugOn ? "block" : "none";
}
function toggleHudDebug() {
  const cur = localStorage.getItem("debugHUD") === "1";
  localStorage.setItem("debugHUD", cur ? "0" : "1");
  applyHudMode();
}

function clearCullingDebugHelpers(sceneRef) {
  for (const helper of cullingHelpers.values()) {
    try { if (sceneRef) sceneRef.remove(helper); } catch (_) {}
  }
  cullingHelpers.clear();
}

function toggleCullingDebug(sceneRef) {
  cullingDebugEnabled = !cullingDebugEnabled;
  if (!cullingDebugEnabled) {
    clearCullingDebugHelpers(sceneRef);
  }
}
(function setupHudDebugToggle() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("debug") === "1") {
      localStorage.setItem("debugHUD", "1");
    }
  } catch (_) {}
  window.addEventListener("keydown", (e) => {
    const isMac = /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform) || /Mac OS X/i.test(navigator.userAgent);
    const isF2 = e.code === "F2" || e.key === "F2" || e.which === 113 || e.keyCode === 113;

    // Mac-friendly alternatives:
    // - Cmd+Shift+H
    // - Option+F2 or Ctrl+F2
    // - Backquote (`) with no modifiers
    const macAlt =
      isMac &&
      (
        (e.metaKey && e.shiftKey && e.code === "KeyH") ||
        (e.altKey && isF2) ||
        (e.ctrlKey && isF2) ||
        (e.code === "Backquote" && !e.metaKey && !e.ctrlKey && !e.altKey)
      );

    if (isF2 || macAlt) {
      e.preventDefault();
      toggleHudDebug();
      return;
    }
    if (e.code === "F4" || e.key === "F4") {
      e.preventDefault();
      toggleCullingDebug(scene);
    }
  });
  applyHudMode();
})();

async function init() {
  if (gameInitialized) return;
  gameInitialized = true;
  playerName = localStorage.getItem("yourName") || "Default";
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(ARCADE_ENVIRONMENT.fogColor, ARCADE_ENVIRONMENT.fogDensity);

  // Preload models/textures (asset preloading + caching)
  const assets = await preloadAssets();
  const boatModel = assets.models.boat;
  const turtleModel = assets.models.turtle;
  const boxModel = assets.models.box;
  const waternormals = assets.textures.waternormals;
  const atlasTexture = assets.textures.atlas;
  const atlasMap = assets.atlasMap || null;

  // Example: progressive preloading for non-critical assets (placeholder)
  progressivePreload([preloadNonCriticalAssets]);

  // Materials and geometries for pooled items
  const geometries = [
    new THREE.SphereGeometry(), // wildlife placeholder
    new THREE.BoxGeometry(), // trash placeholder
    new THREE.TetrahedronGeometry(0.75, 2), // power-up placeholder
  ];

  function makeAtlasMap(tileKey) {
    if (!atlasTexture || !atlasMap || !atlasMap[tileKey]) return null;
    const tex = atlasTexture.clone();
    const region = atlasMap[tileKey];
    tex.offset.set(region.u, region.v);
    tex.repeat.set(region.w, region.h);
    tex.needsUpdate = true;
    return tex;
  }

  const materials = [
    new THREE.MeshPhongMaterial({ color: 0x90ee90 }), // wildlife (green)
    new THREE.MeshLambertMaterial({
      color: 0xbb8e51,
      emissive: 0x2a2418,
      emissiveIntensity: 0.35,
      flatShading: true,
      map: makeAtlasMap("trash"),
    }), // trash (cheaper shader)
    new THREE.MeshLambertMaterial({
      color: 0xffd700,
      emissive: 0x332200,
      emissiveIntensity: 0.9,
      flatShading: true,
      map: makeAtlasMap("powerup"),
    }), // power-up (cheaper shader)
  ];

  // Instanced trash rendering (reduces draw calls)
  const TRASH_INSTANCE_MAX = 500;
  const trashGeometry = geometries[1];
  const trashMaterial = materials[1];
  const powerupGeometry = new THREE.ConeGeometry(0.6, 1.6, 12);
  const powerupMaterial = materials[2];

  function initTrashInstancing() {
    const mesh = new THREE.InstancedMesh(trashGeometry, trashMaterial, TRASH_INSTANCE_MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    const free = [];
    for (let i = 0; i < TRASH_INSTANCE_MAX; i++) {
      free.push(i);
      trashTmpMatrix.identity();
      trashTmpMatrix.setPosition(1e6, 1e6, 1e6);
      mesh.setMatrixAt(i, trashTmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, free, map: new Map(), max: TRASH_INSTANCE_MAX };
  }

  trashInstances = initTrashInstancing();

  function setTrashInstance(itemId, position, size) {
    if (!trashInstances) return false;
    if (trashInstances.map.has(itemId)) return true;
    if (!trashInstances.free.length) return false;
    const idx = trashInstances.free.pop();
    trashInstances.map.set(itemId, idx);
    const s = Number(size) || 1;
    trashTmpScale.set(s, s, s);
    const waterY = typeof position?.y === "number" ? position.y : 0;
    trashTmpPos.set(position.x, waterY + 0.2, position.z);
    trashTmpMatrix.identity();
    trashTmpMatrix.compose(trashTmpPos, new THREE.Quaternion(), trashTmpScale);
    trashInstances.mesh.setMatrixAt(idx, trashTmpMatrix);
    trashInstances.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  clearTrashInstances = function () {
    if (!trashInstances) return;
    for (const idx of trashInstances.map.values()) {
      trashTmpMatrix.identity();
      trashTmpMatrix.setPosition(1e6, 1e6, 1e6);
      trashInstances.mesh.setMatrixAt(idx, trashTmpMatrix);
      trashInstances.free.push(idx);
    }
    trashInstances.map.clear();
    trashInstances.mesh.instanceMatrix.needsUpdate = true;
  };

  function initPowerupInstancing() {
    const mesh = new THREE.InstancedMesh(powerupGeometry, powerupMaterial, 200);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    const free = [];
    for (let i = 0; i < mesh.count; i++) {
      free.push(i);
      powerupTmpMatrix.identity();
      powerupTmpMatrix.setPosition(1e6, 1e6, 1e6);
      mesh.setMatrixAt(i, powerupTmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, free, map: new Map(), max: mesh.count };
  }

  powerupInstances = initPowerupInstancing();

  function setPowerupInstance(itemId, position, size) {
    if (!powerupInstances) return false;
    if (powerupInstances.map.has(itemId)) return true;
    if (!powerupInstances.free.length) return false;
    const idx = powerupInstances.free.pop();
    powerupInstances.map.set(itemId, { idx, rot: Math.random() * Math.PI * 2 });
    const s = Number(size) || 1;
    powerupTmpScale.set(s, s, s);
    const waterY = typeof position?.y === "number" ? position.y : 0;
    powerupTmpPos.set(position.x, waterY + 0.2, position.z);
    powerupTmpEuler.set(0, Math.random() * Math.PI * 2, 0);
    powerupTmpQuat.setFromEuler(powerupTmpEuler);
    powerupTmpMatrix.compose(powerupTmpPos, powerupTmpQuat, powerupTmpScale);
    powerupInstances.mesh.setMatrixAt(idx, powerupTmpMatrix);
    powerupInstances.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  releasePowerupInstance = function (itemId) {
    if (!powerupInstances) return;
    const entry = powerupInstances.map.get(itemId);
    if (!entry) return;
    powerupInstances.map.delete(itemId);
    powerupTmpMatrix.identity();
    powerupTmpMatrix.setPosition(1e6, 1e6, 1e6);
    powerupInstances.mesh.setMatrixAt(entry.idx, powerupTmpMatrix);
    powerupInstances.mesh.instanceMatrix.needsUpdate = true;
    powerupInstances.free.push(entry.idx);
  };

  clearPowerupInstances = function () {
    if (!powerupInstances) return;
    for (const entry of powerupInstances.map.values()) {
      powerupTmpMatrix.identity();
      powerupTmpMatrix.setPosition(1e6, 1e6, 1e6);
      powerupInstances.mesh.setMatrixAt(entry.idx, powerupTmpMatrix);
      powerupInstances.free.push(entry.idx);
    }
    powerupInstances.map.clear();
    powerupInstances.mesh.instanceMatrix.needsUpdate = true;
  };

  releaseTrashInstance = function (itemId) {
    if (!trashInstances) return;
    const idx = trashInstances.map.get(itemId);
    if (idx == null) return;
    trashInstances.map.delete(itemId);
    trashTmpMatrix.identity();
    trashTmpMatrix.setPosition(1e6, 1e6, 1e6);
    trashInstances.mesh.setMatrixAt(idx, trashTmpMatrix);
    trashInstances.mesh.instanceMatrix.needsUpdate = true;
    trashInstances.free.push(idx);
  };

  // Object pooling for wildlife
  const WILDLIFE_POOL_INITIAL = 100;
  const WILDLIFE_POOL_MAX = 280;

  function createWildlifeMesh() {
    // Group wrapper so we can keep the turtle child pitched flat (-90deg X)
    const group = new THREE.Group();
    const turtle = turtleModel.clone(true);
    turtle.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    turtle.rotation.set(-Math.PI / 2, 0, 0); // lie flat on water
    turtle.userData.baseRotX = turtle.rotation.x;
    turtle.userData.baseRotY = turtle.rotation.y;
    turtle.userData.baseRotZ = turtle.rotation.z;
    group.add(turtle);
    // Low LOD fallback (simple sphere)
    const lodLow = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x6aa84f, flatShading: true })
    );
    lodLow.visible = false;
    group.add(lodLow);
    group.userData.lodHigh = turtle;
    group.userData.lodLow = lodLow;
    group.renderOrder = 2;
    group.userData.turtle = turtle;
    group.userData.boatVisual = turtle;
    resetTurtleFloatState(group);
    group.visible = false;
    scene.add(group);
    return group;
  }

  wildlifePool = new ObjectPool({
    name: "wildlife",
    initialSize: WILDLIFE_POOL_INITIAL,
    maxSize: WILDLIFE_POOL_MAX,
    objectSizeBytes: 2200,
    create: createWildlifeMesh,
    reset: (group) => {
      if (!group) return;
      group.visible = false;
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      group.scale.set(1, 1, 1);
      group.userData.ai = null;
      resetTurtleFloatState(group);
      if (group.userData && group.userData.turtle) {
        group.userData.turtle.rotation.set(-Math.PI / 2, 0, 0);
      }
    },
  });

  function getWildlifeFromPool() {
    const group = wildlifePool ? wildlifePool.acquire() : createWildlifeMesh();
    if (!group) return createWildlifeMesh();
    // Ensure correct orientation every time it's reused
    if (group.userData && group.userData.turtle) {
      group.userData.turtle.rotation.set(-Math.PI / 2, 0, 0);
    }
    group.userData.ai = null;
    resetTurtleFloatState(group);
    group.visible = true;
    return group;
  }

  function returnToPoolLocal(mesh) {
    if (wildlifePool) {
      wildlifePool.release(mesh);
      return;
    }
    if (!mesh) return;
    mesh.visible = false;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.ai = null;
    resetTurtleFloatState(mesh);
    if (mesh.userData && mesh.userData.turtle) {
      mesh.userData.turtle.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  // Audio (Firefox-safe: gracefully handle autoplay/codec failures)
  try {
    const audioLoader = new THREE.AudioLoader();
    sounds = await audioLoader.loadAsync("assets/mixkit-motorboat-on-the-sea-1183.m4v");
  } catch (e) {
    console.warn("Audio load failed; continuing without engine sound", e);
    sounds = null;
  }

  // Comms
  const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  // Build base URL from page protocol to ensure wss on HTTPS and ws on HTTP
  const scheme = location.protocol === "https:" ? "https" : "http";
  const wsURL = isDev ? "http://localhost:3000" : `${scheme}://${location.host}`;

  worker = new Worker(new URL("./commsWorker.js", import.meta.url));
  window.__gameWorker = worker;
  worker.postMessage({
    type: "init",
    body: { wsURL, yourId, yourName: playerName, room: roomId, isPresenter: IS_ADMIN_VIEW },
  });
  // If a join was requested before comms started, perform it now
  if (pendingRoomJoinId) {
    try { worker.postMessage({ type: "room.join", body: { id: pendingRoomJoinId } }); } catch (_) {}
    pendingRoomJoinId = null;
  }

  // Lifecycle controls (bind again inside init in case HUD was not ready earlier)
  const startBtnHud = document.getElementById("btn-start-match");
  if (startBtnHud) {
    startBtnHud.onclick = async () => {
      if (!gameInitialized) await init();
      try {
        if (worker) { try { worker.postMessage({ type: "admin.claim" }); } catch (_) {} }
        requestMatchStart();
        // Countdown and state changes will arrive via server events (startingGame/game.state)
      } catch (_) {}
    };
  }
  const endBtnHud = document.getElementById("btn-end-match");
  if (endBtnHud) {
    endBtnHud.onclick = () => {
      if (!isAdmin || (currentPhase !== "GAMEPLAY" && currentPhase !== "STARTING")) return;
      try { if (worker) worker.postMessage({ type: "admin.end" }); } catch (_) {}
      setPhase("POST_GAME");
    };
  }
  const restartBtnHud = document.getElementById("btn-restart-match");
  if (restartBtnHud) {
    restartBtnHud.onclick = () => {
      if (!isAdmin || (currentPhase !== "GAMEPLAY" && currentPhase !== "POST_GAME")) return;
      try { if (worker) worker.postMessage({ type: "admin.end" }); } catch (_) {}
      setTimeout(() => {
        try {
          if (worker) {
            worker.postMessage({ type: "game.start", body: { playerId: yourId, playerName } });
            worker.postMessage({ type: "admin.start" });
          }
        } catch (_) {}
      }, 1200);
    };
  }



  if (!clientGameStarted) {
    const fallbackDuration = gameDuration || 180;
    startGame(
      fallbackDuration,
      [boatModel, turtleModel, boxModel],
      sounds,
      waternormals
    );
    clientGameStarted = true;
  }

  // Debug: append recent events to the Monitor "Events" console if present
  function appendEventConsole(type, payload) {
    try {
      const el = document.getElementById("event-console");
      if (!el) return;
      const time = new Date().toLocaleTimeString();
      const div = document.createElement("div");
      let text;
      try {
        text = typeof payload === "string" ? payload : JSON.stringify(payload);
      } catch (_) {
        text = String(payload);
      }
      div.textContent = `[${time}] ${type}: ${text}`;
      el.appendChild(div);
      // Keep last 200 entries
      while (el.childNodes.length > 200) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    } catch (_) {}
  }

  worker.onmessage = ({ data }) => {
    const { type, body, error } = data;
    try {
      const interesting = ["rooms.update","room.joined","room.admin","game.state","startingGame","chat.message","log"];
      if (interesting.includes(type)) appendEventConsole(type, body);
    } catch (_) {}
    if (error) {
      Object.keys(otherPlayersMeshes).forEach((id) =>
        scene.remove(otherPlayersMeshes[id])
      );
      otherPlayers = {};
      otherPlayersMeshes = {};
    }
    switch (type) {
      case "connect":
        if (!IS_ADMIN_VIEW) {
          try {
            worker.postMessage({
              type: "player.info.joining",
              body: { id: yourId, name: playerName || localStorage.getItem("yourName") || "Default", room: roomId }
            });
          } catch (_) {}
        }
        if (roomId) {
          try { worker.postMessage({ type: "room.join", body: { id: roomId } }); } catch (_) {}
        }
        break;
      case "disconnect":
        break;
      case "log":
        appendEventConsole("log", body);
        break;
      case "commentary.ready": {
        const text = body && (body.commentary || body.text || body.script);
        let el = document.getElementById("results-commentary");
        if (!el) {
          const summary = document.getElementById("results-summary");
          if (summary) {
            el = document.createElement("div");
            el.id = "results-commentary";
            el.className = "results-commentary";
            summary.appendChild(el);
          }
        }
        if (el && text) el.textContent = text;
        appendEventConsole("commentary.ready", body);
        break;
      }
      case "server.info":
        serverVersion = body.version;
        gameDuration = body.gameDuration;
        boundaries.width = body.worldSizeX;
        boundaries.height = body.worldSizeZ;
        serverAuthEnabled = !!body.serverAuthEnabled;
        serverPhysics = body.physics || null;
        if (hudVersionEl) {
          hudVersionEl.innerHTML = "Version: " + (serverVersion || "-");
        }
        // Keep shared timer aligned with authoritative server duration while not running.
        if (Number.isFinite(gameDuration) && gameState !== "RUNNING" && gameState !== "STARTING") {
          lastServerTimeSyncValue = Number(gameDuration);
          lastServerTimeSyncAtMs = Date.now();
          renderTimeValue(gameDuration);
        }
        break;
      case "game.on":
        {
          // Respect manual navigation: ignore server start when user is in Menu/Access
          if (currentPhase === "MENU" || currentPhase === "ACCESS" || currentPhase === "ADMIN") {
            break;
          }
          const sp = body && body.startPosition ? body.startPosition : null;
          startPosition = sp;
          if (gameState !== "RUNNING") {
            gameState = "RUNNING";
            setPhase("GAMEPLAY");
            resetGameplayTelemetry();
            emitGameplayEvent("game_started", {
              position: sp || currentPlayerPosition(),
              start_position: sp || null,
            });
            clearCountdown();
            if (!Number.isFinite(lastServerTimeSyncValue) && Number.isFinite(gameDuration)) {
              lastServerTimeSyncValue = Number(gameDuration);
              lastServerTimeSyncAtMs = Date.now();
              renderTimeValue(gameDuration);
            }
            startLocalTimeTicker();
            try { if (typeof updateControls === "function") updateControls(); } catch (_) {}
          }
          worker.postMessage({
            type: "game.start",
            body: { playerId: yourId, playerName },
          });
          if (!clientGameStarted) {
            startGame(
              gameDuration,
              [boatModel, turtleModel, boxModel],
              sounds,
              waternormals
            );
            clientGameStarted = true;
          }
        }
        break;
      case "game.end":
        if (currentPhase === "ADMIN") {
          setAdminStatus("Match ended.", "Ended");
          break;
        }
        endGame();
        break;
      case "items.all":
        Object.keys(body).forEach((key) => {
          if (!items[key]) {
            createItemMesh(
              key,
              body[key].type,
              body[key].position,
              body[key].size
            );
          }
          items[key] = body[key];
        });
        break;
      case "item.new":
        {
          const { id: itemIdToCreate, data: itemData } = body;
          pendingItemCollisions.delete(itemIdToCreate);
          scoredItemCollisions.delete(itemIdToCreate);
          if (items[itemIdToCreate] || itemMeshes[itemIdToCreate]) {
            removeItemFromScene(itemIdToCreate);
          }
          createItemMesh(
            itemIdToCreate,
            itemData.type,
            itemData.position,
            itemData.size
          );
          items[itemIdToCreate] = itemData;
        }
        break;
      case "item.destroy":
        {
          const payload = normalizeItemDestroyPayload(body);
          applyConfirmedCollisionOutcome(payload);
          removeItemFromScene(payload.itemId || payload.id);
        }
        break;
      case "items.collision.result":
        {
          const payload = normalizeItemDestroyPayload(body);
          if (payload.ok) {
            applyConfirmedCollisionOutcome(payload);
            removeItemFromScene(payload.itemId || payload.id);
          } else if (payload.itemId || payload.id) {
            pendingItemCollisions.delete(payload.itemId || payload.id);
          }
        }
        break;
      case "player.trace.all":
        for (const [key, traceData] of Object.entries(body)) {
          otherPlayers[key] = traceData;
          if (!otherPlayersMeshes[key]) {
            otherPlayersMeshes[key] = makePlayerMesh(boatModel, key);
          }
        }
        updatePlayersHud();
        break;
      case "player.info.joined":
        {
          const { id: joinedId, name: joinedName } = body || {};
          if (joinedId) {
            // Ensure name map is updated so subsequent mesh creation shows correct label
            if (joinedName) {
              otherPlayersInfo[joinedId] = { name: joinedName };
            }
            // Create mesh if not present; will pick name from otherPlayersInfo
            if (joinedId !== yourId && !otherPlayersMeshes[joinedId]) {
              otherPlayersMeshes[joinedId] = makePlayerMesh(boatModel, joinedId);
            }
            // Refresh existing name tag if mesh already exists
            if (otherPlayersMeshes[joinedId]) {
              refreshNameTagForPlayer(joinedId);
            }
          }
          updatePlayersHud();
        }
        break;
      case "player.info.left":
        {
          const playerId = body;
          if (playerId !== yourId) {
            returnBoatToPool(otherPlayersMeshes[playerId]);
            delete otherPlayersMeshes[playerId];
            delete otherPlayers[playerId];
            // Clean up that player's trail
            if (trails[playerId]) {
              scene.remove(trails[playerId].line);
              delete trails[playerId];
            }
          }
          updatePlayersHud();
        }
        break;
      case "player.info.all":
        otherPlayersInfo = body || {};
        try {
          Object.keys(otherPlayersInfo || {}).forEach((id) => {
            if (otherPlayersMeshes[id]) refreshNameTagForPlayer(id);
          });
        } catch (_) {}
        updatePlayersHud();
        break;
      case "game.state": {
        gameState = body;
        // Respect manual navigation: do not override when user is in Menu or Access
        if (currentPhase === "MENU" || currentPhase === "ACCESS" || currentPhase === "ADMIN") {
          if (currentPhase === "ADMIN") {
            const stateText = String(body || "WAITING");
            setAdminStatus("Room " + (roomId || getConfiguredAdminRoom()) + " is " + stateText + ".", stateText);
          }
          break;
        }
        if (body === "WAITING") {
          const statusEl = document.getElementById("lobby-status");
          if (statusEl) statusEl.textContent = "Waiting for game...";
          if (Number.isFinite(gameDuration)) {
            lastServerTimeSyncValue = Number(gameDuration);
            lastServerTimeSyncAtMs = Date.now();
            renderTimeValue(gameDuration);
          }
          stopLocalTimeTicker();
          setPhase("LOBBY");
        } else if (body === "STARTING") {
          stopLocalTimeTicker();
          setPhase("STARTING");
        } else if (body === "RUNNING") {
          if (!Number.isFinite(lastServerTimeSyncValue) && Number.isFinite(gameDuration)) {
            lastServerTimeSyncValue = Number(gameDuration);
            lastServerTimeSyncAtMs = Date.now();
          }
          startLocalTimeTicker();
          setPhase("GAMEPLAY");
        } else if (body === "ENDED") {
          stopLocalTimeTicker();
          endGame();
          setPhase("POST_GAME");
        }
        if (typeof updateControls === "function") updateControls();
        break;
      }
      case "game.time":
        lastServerTimeSyncValue = Number(body);
        lastServerTimeSyncAtMs = Date.now();
        renderTimeValue(body);
        break;
      case "player.state":
        if (body && body.states) {
          authStates = body.states;
          authStatesTime = body.t || performance.now();
        }
        break;
      case "server.metrics":
        updateMonitor(body || {});
        break;
      case "network.stats":
        if (body && typeof body === "object") {
          networkStats = {
            upKbps: Number(body.upKbps) || 0,
            downKbps: Number(body.downKbps) || 0,
            rttMs: Number.isFinite(body.rttMs) ? Number(body.rttMs) : null,
            quality: body.quality || "unknown",
            lossRate: Number(body.lossRate) || 0,
          };
          updateNetworkMonitorOnly();
        }
        break;
      case "rooms.update": {
        roomsDirectory = body || null;
        // If we don't yet know our room, reflect default in HUD for UX
        if (!roomId && body && body.default) {
          roomId = body.default;
          updateRoomHud();
        }
        renderRoomsDirectory();
        break;
      }
      case "room.joined": {
        // Authoritative room assignment acknowledgment
        const joined = body && body.id ? String(body.id) : null;
        if (joined) {
          roomId = joined;
          roomJoinedAck = true;
          if (IS_ADMIN_VIEW) {
            syncAdminRoomUi(joined);
            setAdminStatus("Connected to " + joined + ".", gameState || "Waiting");
          }
          updateRoomHud();
          // Do not pull the UI back to Lobby if the user navigated to Menu/Access
          if (
            currentPhase !== "GAMEPLAY" &&
            currentPhase !== "STARTING" &&
            currentPhase !== "POST_GAME" &&
            currentPhase !== "MENU" &&
            currentPhase !== "ACCESS" &&
            currentPhase !== "ADMIN"
          ) {
            setPhase("LOBBY");
          }
          // If user clicked Start before ack, continue now (only while in Lobby)
          if (pendingStartRequested && currentPhase === "LOBBY") {
            pendingStartRequested = false;
            setTimeout(() => {
              try { requestMatchStart(); } catch (_) {}
            }, 50);
          }
          if (autoStartMatch && currentPhase === "LOBBY") {
            setTimeout(() => {
              requestAutoStartMatch();
            }, 120);
          }
        }
        break;
      }
      case "room.admin": {
        const adminId = body && body.id ? String(body.id) : null;
        isAdmin = adminId === yourId;
        if (typeof updateControls === "function") updateControls();
        if (autoStartMatch && currentPhase === "LOBBY") {
          setTimeout(() => {
            requestAutoStartMatch();
          }, 120);
        }
        break;
      }
      case "chat.history": {
        const log = document.getElementById("chat-log");
        if (log) {
          log.innerHTML = "";
          try {
            const arr = Array.isArray(body) ? body : [];
            for (const msg of arr) {
              const t = new Date((msg && msg.ts) ? msg.ts : Date.now());
              const hh = String(t.getHours()).padStart(2, "0");
              const mm = String(t.getMinutes()).padStart(2, "0");
              const name = (msg && msg.name) ? String(msg.name) : "Player";
              const text = (msg && msg.text) ? String(msg.text) : (typeof msg === "string" ? msg : "");
              const div = document.createElement("div");
              div.textContent = `[${hh}:${mm}] ${name}: ${text}`;
              log.appendChild(div);
            }
            log.scrollTop = log.scrollHeight;
          } catch (_) {}
        }
        break;
      }
      case "chat.message": {
        const log = document.getElementById("chat-log");
        if (log) {
          const t = new Date((body && body.ts) ? body.ts : Date.now());
          const hh = String(t.getHours()).padStart(2, "0");
          const mm = String(t.getMinutes()).padStart(2, "0");
          const name = (body && body.name) ? String(body.name) : "Player";
          const text = (body && body.text) ? String(body.text) : (typeof body === "string" ? body : "");
          const div = document.createElement("div");
          div.textContent = `[${hh}:${mm}] ${name}: ${text}`;
          log.appendChild(div);
          log.scrollTop = log.scrollHeight;
        }
        break;
      }
      case "lobby.players": {
        const renderRoster = (list) => {
          if (!list) return;
          list.innerHTML = "";
          let arr = [];
          if (Array.isArray(body)) {
            arr = body.map((value, index) => ({
              id: value && value.id ? String(value.id) : String(index + 1),
              name: typeof value === "string" ? value : (value && value.name ? String(value.name) : "Player"),
            }));
          } else if (body && typeof body === "object") {
            arr = Object.entries(body).map(([id, value]) => ({
              id: String(id),
              name: value && value.name ? String(value.name) : String(id),
            }));
          }
          for (const p of arr) {
            const li = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = p.name || "Player";
            const id = document.createElement("span");
            id.className = "hud-item";
            id.textContent = p.id || "";
            li.appendChild(name);
            li.appendChild(id);
            list.appendChild(li);
          }
          return arr.length;
        };
        const lobbyCount = renderRoster(document.getElementById("waiting-list")) || 0;
        const adminCount = renderRoster(document.getElementById("admin-player-list"));
        const countEl = document.getElementById("admin-player-count");
        if (countEl) countEl.textContent = String(Number.isFinite(adminCount) ? adminCount : lobbyCount);
        break;
      }
      case "startingGame": {
        // Do not force STARTING if user navigated back to Menu/Access
        if (currentPhase === "MENU" || currentPhase === "ACCESS") break;
        if (currentPhase === "ADMIN") {
          setAdminStatus("Countdown running for " + (roomId || getConfiguredAdminRoom()) + ".", "Starting");
          break;
        }
        // Ignore late countdown events once gameplay is already running
        if (gameState === "RUNNING" || currentPhase === "GAMEPLAY") break;
        gameState = "STARTING";
        setPhase("STARTING");
        const startsAt = body && (body.startsAt || body.startAt);
        if (startsAt) {
          startCountdownAt(startsAt);
        } else {
          const ms = (body && (body.ms || body.countdownMs)) || (body && body.seconds ? body.seconds * 1000 : 10000);
          startCountdown(ms);
        }
        break;
      }
      case "admin.start.requested": {
        const st = document.getElementById("lobby-status");
        if (st) st.textContent = "Starting match…";
        break;
      }
      case "admin.start.confirmed": {
        const st = document.getElementById("lobby-status");
        if (st) {
          const scope = body && body.scope ? body.scope : "room";
          st.textContent = "Start confirmed (" + scope + ").";
        }
        break;
      }
      case "admin.presenter.start.requested": {
        setAdminStatus("Starting " + getConfiguredAdminRoom() + "...", "Starting");
        break;
      }
      case "admin.presenter.start.confirmed": {
        if (body && body.ok === false) {
          const state = body.state ? " (" + body.state + ")" : "";
          setAdminStatus("Start failed: " + (body.error || "unknown") + state + ".", "Error");
        } else {
          setAdminStatus("Countdown started for " + ((body && body.room) || getConfiguredAdminRoom()) + ".", "Starting");
        }
        break;
      }
      case "admin.presenter.start.error": {
        setAdminStatus("Start failed: " + (body || "unknown") + ".", "Error");
        break;
      }
      case "admin.start.error": {
        const st = document.getElementById("lobby-status");
        if (st) st.textContent = "Start failed: " + (body || "unknown");
        break;
      }
      case "admin.presenter.end.requested": {
        setAdminStatus("Ending " + getConfiguredAdminRoom() + "...", "Ending");
        break;
      }
      case "admin.presenter.end.confirmed": {
        if (body && body.ok === false) {
          const state = body.state ? " (" + body.state + ")" : "";
          setAdminStatus("End failed: " + (body.error || "unknown") + state + ".", "Error");
        } else {
          setAdminStatus("Match ended for " + ((body && body.room) || getConfiguredAdminRoom()) + ".", "Ended");
        }
        break;
      }
      case "admin.presenter.end.error": {
        setAdminStatus("End failed: " + (body || "unknown") + ".", "Error");
        break;
      }
      case "admin.end.confirmed": {
        const st = document.getElementById("lobby-status");
        if (st) st.textContent = "Match ended.";
        break;
      }
      case "admin.end.error": {
        const st = document.getElementById("lobby-status");
        if (st) st.textContent = "End failed: " + (body || "unknown");
        break;
      }
      default:
        break;
    }
  };

  // Handle disconnect on unload
  window.addEventListener("beforeunload", function () {
    worker.postMessage({ type: "close" });
  });

  // Object pooling for boats (other players)
  const BOAT_POOL_SIZE = 50;

  function createBoatGroup() {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    return group;
  }

  boatPool = new ObjectPool({
    name: "boats",
    initialSize: BOAT_POOL_SIZE,
    maxSize: 140,
    objectSizeBytes: 6400,
    create: createBoatGroup,
    reset: (group) => {
      if (!group) return;
      group.visible = false;
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      while (group.children.length) {
        const ch = group.children[0];
        group.remove(ch);
        if (ch && ch.name === "nameTag" && uiNameTagPool) {
          uiNameTagPool.release(ch);
        }
      }
    },
  });

  function getBoatFromPool() {
    const group = boatPool ? boatPool.acquire() : createBoatGroup();
    if (!group) return createBoatGroup();
    group.visible = true;
    return group;
  }

  function returnBoatToPool(group) {
    if (!group) return;
    if (boatPool) {
      boatPool.release(group);
      return;
    }
    group.visible = false;
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    while (group.children.length) group.remove(group.children[0]);
  }

  function serializableUserData(userData) {
    const safe = {};
    for (const [key, value] of Object.entries(userData || {})) {
      if (value && value.isObject3D) continue;
      if (typeof value === "function") continue;
      try {
        JSON.stringify(value);
        safe[key] = value;
      } catch (_) {
        // Three.js clones userData through JSON; skip circular debug/runtime refs.
      }
    }
    return safe;
  }

  function cloneModelForRemotePlayer(playerMesh) {
    const originalUserData = playerMesh.userData;
    playerMesh.userData = serializableUserData(originalUserData);
    try {
      return playerMesh.clone();
    } finally {
      playerMesh.userData = originalUserData;
    }
  }

  function makePlayerMesh(playerMesh, id) {
    const group = getBoatFromPool();
    const mesh = cloneModelForRemotePlayer(playerMesh);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    group.add(mesh);
    // Low LOD boat (simple box)
    const lodLow = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.25, 1.6),
      new THREE.MeshLambertMaterial({ color: 0x547ea5, flatShading: true })
    );
    lodLow.visible = false;
    group.add(lodLow);
    group.userData.lodHigh = mesh;
    group.userData.lodLow = lodLow;
    group.userData.boatVisual = mesh;
    const label =
      (otherPlayersInfo[id] && otherPlayersInfo[id].name)
        ? otherPlayersInfo[id].name
        : (id ? id.substring(0, 4) : "Player");
    addNameTag(group, label);
    return group;
  }

  // Create a random trash or wildlife or power-up object
  function createItemMesh(itemId, itemType, position, size) {
    let itemMesh;
    if (isMarineLife(itemType)) {
      itemMesh = getWildlifeFromPool();
    } else if (isPowerUp(itemType)) {
      const placed = setPowerupInstance(itemId, position, size);
      if (placed) return null;
      itemMesh = new THREE.Mesh(powerupGeometry, powerupMaterial);
      itemMesh.castShadow = true;
      itemMesh.receiveShadow = true;
      itemMesh.rotation.y = Math.random() * Math.PI; // subtle idle spin
      scene.add(itemMesh);
      try { disableReflectionForObject(itemMesh); } catch (_) {}
    } else {
      const placed = setTrashInstance(itemId, position, size);
      if (placed) return null;
      const geometry = geometries[1];
      const material = materials[1];
      itemMesh = new THREE.Mesh(geometry, material);
      scene.add(itemMesh);
    }
    itemMesh.renderOrder = 2;
    const y = (typeof position.y === "number" ? position.y : 0) + (isMarineLife(itemType) ? 0 : 0.08);
    itemMesh.position.set(position.x, y, position.z);

    // Placeholder for trash animation system (kept from original, guarded)
    if (!isMarineLife(itemType) && !isPowerUp(itemType)) {
      if (itemMesh.animations && itemMesh.mixer) {
        itemMesh.animationActions = itemMesh.animations.map((animation) => {
          const action = itemMesh.mixer.clipAction(animation);
          action.addEventListener("finished", function () {
            itemMesh.playingAnimationsCount--;
            if (itemMesh.playingAnimationsCount === 0) {
              scene.remove(itemMesh);
              delete itemMeshes[itemId];
            }
          });
          return action;
        });
      }
    }

    const s = Number(size) || 1;
    itemMesh.scale.set(s, s, s);
    itemMesh.itemId = itemId;
    itemMesh.itemType = itemType;
    itemMesh.isTrash = !isMarineLife(itemType) && !isPowerUp(itemType);
    itemMesh.outOfBounds = false;

    // bounds check (position-based to avoid overly aggressive Box3 culling at spawn)
    const halfW = (boundaries?.width || 100) / 2;
    const halfH = (boundaries?.height || 100) / 2;
    if (Math.abs(itemMesh.position.x) > halfW - 1 || Math.abs(itemMesh.position.z) > halfH - 1) {
      itemMesh.outOfBounds = true;
      if (isMarineLife(itemType)) returnToPoolLocal(itemMesh);
      else scene.remove(itemMesh);
      return;
    }

    itemMeshes[itemId] = itemMesh;
    return itemMesh;
  }

  // Overlay/screen visibility is managed by setPhase(); do not toggle here.
  // Ensure keyboard focus is available
  try {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    if (document.body) {
      document.body.tabIndex = -1;
      document.body.focus({ preventScroll: true });
    }
    if (window && window.focus) window.focus();
  } catch (_) {}
}

/**
 * Helper: return pooled mesh to pool (hide & reset transforms)
 * Module scope for use in startGame/checkCollisions outside init.
 */
// Trail helpers and utilities
function colorFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const r = hash & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = (hash >> 16) & 0xff;
  return new THREE.Color(r / 255, g / 255, b / 255);
}

function ensureTrail(id) {
  if (trails[id]) return trails[id];
  const geom = new THREE.BufferGeometry();
  const mat = new THREE.LineBasicMaterial({
    color: id === yourId ? 0xff8800 : colorFromId(id),
  });
  const line = new THREE.Line(geom, mat);
  // Keep trails visible even when off-screen for now
  line.frustumCulled = false;
  // Initialize with empty buffer and keep hidden until there are >= 2 points
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  geom.setDrawRange(0, 0);
  line.visible = false;
  scene.add(line);
  const trail = { id, points: [], line, lastAdd: new THREE.Vector3(), lastAddMs: performance.now() };
  trails[id] = trail;
  return trail;
}

function addTrailPoint(id, position) {
  const trail = ensureTrail(id);
  if (
    trail.points.length === 0 ||
    trail.lastAdd.distanceToSquared(position) >
      TRAIL_POINT_DISTANCE * TRAIL_POINT_DISTANCE
  ) {
    trail.points.push(position.clone());
    trail.lastAdd.copy(position);
    trail.lastAddMs = performance.now();
    if (trail.points.length > MAX_TRAIL_POINTS) trail.points.shift();

    const arr = new Float32Array(trail.points.length * 3);
    trail.points.forEach((p, i) => {
      arr[i * 3 + 0] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    });
    trail.line.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(arr, 3)
    );
    trail.line.geometry.setDrawRange(0, trail.points.length);
    trail.line.geometry.attributes.position.needsUpdate = true;
    // Hide when fewer than two points (no visible segment)
    trail.line.visible = trail.points.length > 1;
  }
}

function applyTextureQuality(target, level) {
  if (!target) return;
  if (!target.userData) target.userData = {};
  if (target.userData.textureQuality === level) return;
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  const anisotropy = level === "low" ? 1 : Math.min(4, maxAniso || 1);
  const textureKeys = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"];
  target.traverse((obj) => {
    if (!obj || !obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      if (!mat) return;
      textureKeys.forEach((key) => {
        const tex = mat[key];
        if (!tex) return;
        tex.anisotropy = anisotropy;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
      });
    });
  });
  target.userData.textureQuality = level;
}

function applyLodForGroup(group) {
  if (!group || !camera) return;
  const lodHigh = group.userData && group.userData.lodHigh;
  const lodLow = group.userData && group.userData.lodLow;
  if (!lodHigh || !lodLow) return;
  const dist = camera.position.distanceTo(group.position);
  const useLow = dist > LOD_DISTANCES.medium;
  lodHigh.visible = !useLow;
  lodLow.visible = useLow;
  applyTextureQuality(lodHigh, useLow ? "low" : "high");
}

/**
 * Name tags above boats
 */
function createNameSprite(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  setNameSpriteText(sprite, text || "");
  return sprite;
}

function setNameSpriteText(sprite, text) {
  if (!sprite || !sprite.userData || !sprite.userData.canvas || !sprite.userData.ctx) return;
  const canvas = sprite.userData.canvas;
  const ctx = sprite.userData.ctx;
  const fontSize = 48;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "black";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "black";
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  if (sprite.material && sprite.material.map) {
    sprite.material.map.needsUpdate = true;
  }
}

function ensureUiPools() {
  if (uiNameTagPool) return;
  uiNameTagPool = new ObjectPool({
    name: "uiNameTags",
    initialSize: 24,
    maxSize: 120,
    objectSizeBytes: 1024,
    create: () => createNameSprite(""),
    reset: (sprite) => {
      if (!sprite) return;
      sprite.visible = false;
      sprite.position.set(0, 1.4, 0);
      setNameSpriteText(sprite, "");
    },
  });
}
function addNameTag(object3d, name) {
  ensureUiPools();
  const sprite = uiNameTagPool ? uiNameTagPool.acquire() : createNameSprite(name);
  if (!sprite) return null;
  sprite.name = "nameTag";
  setNameSpriteText(sprite, name || "");
  sprite.position.set(0, 1.4, 0);
  sprite.visible = true;
  object3d.add(sprite);
  return sprite;
}
function updateNameTag(object3d, name) {
  if (!object3d) return;
  let tag = null;
  try {
    for (const c of object3d.children) {
      if (c && c.name === "nameTag") {
        tag = c;
        break;
      }
    }
  } catch (_) {}
  if (!tag) {
    addNameTag(object3d, name);
    return;
  }
  setNameSpriteText(tag, name || "");
  tag.visible = true;
}
function refreshNameTagForPlayer(id) {
  if (!id) return;
  const group = otherPlayersMeshes[id];
  if (!group) return;
  const label =
    (otherPlayersInfo[id] && otherPlayersInfo[id].name)
      ? otherPlayersInfo[id].name
      : (id ? id.substring(0, 4) : "Player");
  updateNameTag(group, label);
}

// Emoji power-up badge (sprite updated dynamically)
function createEmojiSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.6, 0.6, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = ctx;
  setSpriteText(sprite, text || "");
  return sprite;
}
function setSpriteText(sprite, text) {
  const canvas = sprite.userData.canvas;
  const ctx = sprite.userData.ctx;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  if (text && text.length) {
    ctx.font = "bold 80px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "black";
    ctx.shadowBlur = 8;
    ctx.fillText(text, size / 2, size / 2 + 6);
  }
  sprite.material.map.needsUpdate = true;
}
function disableReflectionForSprite(sprite) {
  if (!sprite) return;
  const prev = { visible: true };
  sprite.onBeforeRender = function (renderer) {
    try {
      const rt = renderer.getRenderTarget && renderer.getRenderTarget();
      if (rt) {
        prev.visible = sprite.visible;
        sprite.visible = false;
      }
    } catch (_) {}
  };
  sprite.onAfterRender = function () {
    try { sprite.visible = prev.visible; } catch (_) {}
  };
}

// Generic helper: hide any Object3D from water reflection render passes
function disableReflectionForObject(obj) {
  if (!obj) return;
  const prev = { visible: true };
  obj.onBeforeRender = function (renderer) {
    try {
      const rt = renderer.getRenderTarget && renderer.getRenderTarget();
      if (rt) {
        prev.visible = obj.visible;
        obj.visible = false;
      }
    } catch (_) {}
  };
  obj.onAfterRender = function () {
    try { obj.visible = prev.visible; } catch (_) {}
  };
}
function updatePowerUpBadge() {
  if (!powerupBadge) return;
  const icons = [];
  // Effects
  if (powerUpState.speedMultiplier > 1) icons.push("⚡");
  if (powerUpState.shield) icons.push("🛡️");
  if (Date.now() < (powerUpState.magnetUntil || 0)) icons.push("🧲");
  if (Date.now() < (powerUpState.freezeUntil || 0)) icons.push("❄️");
  // Freeze indicator while active
  const freezeActive = Date.now() < (freezeUntilMs || 0);
  if (freezeActive) icons.push("❄️");
  const str = icons.join("");
  setSpriteText(powerupBadge, str);
  powerupBadge.visible = str.length > 0;
}
// Above-boat frozen/countdown indicator (emoji+text)
function updateFrozenIndicators() {
  if (!statusBadge) return;
  const now = Date.now();
  // During synchronized countdown, hide status badge to avoid clutter with 3D countdown
  if (currentPhase === "STARTING") {
    setSpriteText(statusBadge, "");
    statusBadge.visible = false;
    return;
  }
  const active = now < (freezeUntilMs || 0);
  if (active) {
    const left = Math.max(0, Math.ceil((freezeUntilMs - now) / 1000));
    setSpriteText(statusBadge, `❄️ ${left}s`);
    statusBadge.visible = true;
  } else {
    setSpriteText(statusBadge, "");
    statusBadge.visible = false;
  }
}

function updatePlayersHud() {
  if (!hudPlayersEl) return;
  try {
    const count = 1 + Object.keys(otherPlayersMeshes || {}).length;
    hudPlayersEl.innerHTML = "Players: " + count;
    optimizePoolSizesForPlayers(count);
  } catch (_) {}
}

function optimizePoolSizesForPlayers(playerCount) {
  const p = Math.max(1, Number(playerCount) || 1);
  try {
    if (wildlifePool) {
      wildlifePool.resize(Math.min(240, 60 + p * 18), 280);
    }
    if (boatPool) {
      boatPool.resize(Math.min(120, 20 + p * 8), 140);
    }
    if (uiNameTagPool) {
      uiNameTagPool.resize(Math.min(100, 12 + p * 5), 120);
    }
  } catch (_) {}
}

function collectPoolMetrics() {
  const wildlife = wildlifePool ? wildlifePool.metrics() : null;
  const boats = boatPool ? boatPool.metrics() : null;
  const ui = uiNameTagPool ? uiNameTagPool.metrics() : null;
  let particles = null;
  try {
    if (emitters && typeof emitters.metrics === "function") {
      particles = emitters.metrics();
    }
  } catch (_) {}
  let totalBytes = 0;
  [wildlife, boats, ui].forEach((m) => {
    if (m && Number.isFinite(m.memoryEstimateBytes)) totalBytes += m.memoryEstimateBytes;
  });
  if (particles && Number.isFinite(particles.memoryEstimateBytes)) {
    totalBytes += particles.memoryEstimateBytes;
  }
  latestPoolMetrics = { wildlife, boats, ui, particles, totalBytes };
  return latestPoolMetrics;
}

function updateNetworkMonitorOnly() {
  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  setText("mon-net-up", `${(Number(networkStats.upKbps) || 0).toFixed(2)} kbps`);
  setText("mon-net-down", `${(Number(networkStats.downKbps) || 0).toFixed(2)} kbps`);
  setText("mon-net-rtt", networkStats.rttMs != null ? `${networkStats.rttMs} ms` : "-");
  setText("mon-net-loss", `${(Number(networkStats.lossRate) * 100).toFixed(1)}%`);
  setText("mon-net-quality", networkStats.quality || "unknown");
  const pm = collectPoolMetrics();
  if (pm) {
      const fmt = (m) =>
        m
          ? `${m.inUse}/${m.total} avg ${m.avgAcquireMs}ms/${m.avgReleaseMs}ms life ${m.avgLifetimeMs}ms err ${m.errors}`
          : "-";
    setText("mon-pool-wildlife", fmt(pm.wildlife));
    setText("mon-pool-boats", fmt(pm.boats));
    setText("mon-pool-ui", fmt(pm.ui));
    setText("mon-pool-particles", pm.particles ? `${pm.particles.alive}/${pm.particles.capacity}` : "-");
    setText("mon-pool-memory", `${Math.round((pm.totalBytes || 0) / 1024)} KB`);
  }
  const rs = collectRenderMetrics();
  if (rs) {
    setText("mon-render-fps", rs.fps.toFixed(1));
    setText("mon-render-frame", `${rs.frameMs.toFixed(2)} ms`);
    setText("mon-render-draws", rs.drawCalls);
    setText("mon-render-tris", rs.triangles.toLocaleString());
    const programText = Number.isFinite(rs.programs) ? rs.programs : "-";
    setText("mon-render-memory", `${rs.geometries}/${rs.textures}/${programText}`);
  }
  const assetStats = getAssetCacheStats();
    setText("mon-asset-models", assetStats.models);
    setText("mon-asset-textures", assetStats.textures);
    setText("mon-asset-preload", assetStats.preloadStarted ? "ready" : "idle");
    setText("mon-lod", `H<${LOD_DISTANCES.high} M<${LOD_DISTANCES.medium} L<${LOD_DISTANCES.low}`);
}

function collectRenderMetrics() {
  if (!renderer || !renderer.info) return renderStats;
  const info = renderer.info;
  renderStats = {
    fps: smoothedFrameMs > 0 ? 1000 / smoothedFrameMs : 0,
    frameMs: smoothedFrameMs,
    drawCalls: Number(info.render.calls) || 0,
    triangles: Number(info.render.triangles) || 0,
    geometries: Number(info.memory.geometries) || 0,
    textures: Number(info.memory.textures) || 0,
    programs: Array.isArray(info.programs) ? info.programs.length : null,
  };
  return renderStats;
}

// Debug Object Monitor rendering
function updateMonitor(m) {
  if (!m || typeof m !== "object") return;
  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
  };
  // Players
  setText("mon-humans", m.players && m.players.humans != null ? m.players.humans : "-");
  setText("mon-bots", m.players && m.players.bots != null ? m.players.bots : "-");
  setText("mon-total", m.players && m.players.total != null ? m.players.total : "-");
  // World
  setText("mon-world-x", m.world && m.world.x != null ? m.world.x : "-");
  setText("mon-world-z", m.world && m.world.z != null ? m.world.z : "-");
  setText("mon-mode", m.spawn && m.spawn.mode ? m.spawn.mode : "-");
  try {
    const sel = document.getElementById("mon-mode-select");
    if (sel && m.spawn && m.spawn.mode) sel.value = m.spawn.mode;
  } catch (_) {}
  // Counts / Targets
  setText("mon-trash", m.items && m.items.trash != null ? m.items.trash : "-");
  setText("mon-marine", m.items && m.items.marine != null ? m.items.marine : "-");
  setText("mon-power", m.items && m.items.powerups != null ? m.items.powerups : "-");
  setText("mon-target-trash", m.targets && m.targets.trash != null ? m.targets.trash : "-");
  setText("mon-target-marine", m.targets && m.targets.marine != null ? m.targets.marine : "-");
  setText("mon-target-power", m.targets && m.targets.powerups != null ? m.targets.powerups : "-");
  setText("mon-next-spawn", m.spawn && m.spawn.nextTickMs != null ? m.spawn.nextTickMs : "-");
  updateNetworkMonitorOnly();
}

function distPointToSegmentSq(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(p, a);
  const abLenSq = ab.lengthSq();
  const t =
    abLenSq > 0 ? Math.max(0, Math.min(1, ap.dot(ab) / abLenSq)) : 0;
  const closest = new THREE.Vector3().copy(a).add(ab.multiplyScalar(t));
  return p.distanceToSquared(closest);
}

function checkTrailCollisionsWithPlayer() {
  if (Date.now() < freezeUntilMs) return;
  if (!player) return;
  const p = player.position;
  for (const [id, trail] of Object.entries(trails)) {
    if (id === yourId) continue;
    const pts = trail.points;
    for (let i = 0; i < pts.length - 1; i++) {
      if (
        distPointToSegmentSq(p, pts[i], pts[i + 1]) <
        TRAIL_COLLISION_RADIUS * TRAIL_COLLISION_RADIUS
      ) {
        // Apply freeze effect for 5 seconds
        freezeUntilMs = Date.now() + 5000;
        eventStats.trail_crossed++;
        eventStats.player_frozen++;
        emitGameplayEvent("trail_crossed", {
          related_player_id: id,
          trail_segment: {
            from: { x: Number(pts[i].x || 0), y: Number(pts[i].y || 0), z: Number(pts[i].z || 0) },
            to: { x: Number(pts[i + 1].x || 0), y: Number(pts[i + 1].y || 0), z: Number(pts[i + 1].z || 0) },
          },
        });
        emitGameplayEvent("player_frozen", {
          related_player_id: id,
          freeze_ms: 5000,
        });
        try {
          triggerReplayMoment("player_frozen", {
            relatedPlayerId: id,
            freezeMs: 5000,
            worldPos: currentPlayerPosition(),
            trailSegment: {
              from: { x: Number(pts[i].x || 0), y: Number(pts[i].y || 0), z: Number(pts[i].z || 0) },
              to: { x: Number(pts[i + 1].x || 0), y: Number(pts[i + 1].y || 0), z: Number(pts[i + 1].z || 0) },
            },
          });
        } catch (_) {}
        if (!freezeDiv) {
          freezeDiv = document.createElement("div");
          freezeDiv.style.position = "absolute";
          freezeDiv.style.top = "120px";
          freezeDiv.style.left = "10px";
          freezeDiv.style.color = "white";
          freezeDiv.style.fontSize = "16px";
          freezeDiv.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
          document.body.appendChild(freezeDiv);
        }
        freezeDiv.innerHTML = "Frozen: 5s";
        if (emitters) emitters.collision.trigger(player.position);
        updatePowerUpBadge();
        updateFrozenIndicators();
        return;
      }
    }
  }
}

function cleanupOldTrails() {
  const now = performance.now();
  for (const [id, trail] of Object.entries(trails)) {
    if (!trail || !trail.line) continue;
    if (!trail.lastAddMs) continue;
    if (now - trail.lastAddMs > TRAIL_TTL_MS) {
      // Fully remove stale trails from the scene and map
      scene.remove(trail.line);
      if (trail.line.geometry) trail.line.geometry.dispose();
      if (trail.line.material) trail.line.material.dispose();
      delete trails[id];
    }
  }
}

function returnToPool(mesh) {
  if (!mesh) return;
  if (mesh.itemType === "turtle" && wildlifePool) {
    wildlifePool.release(mesh);
    return;
  }
  mesh.visible = false;
  if (mesh.position) mesh.position.set(0, 0, 0);
  // Reset wrapper group rotation
  if (mesh.rotation) mesh.rotation.set(0, 0, 0);
  if (mesh.userData) {
    mesh.userData.ai = null;
    resetTurtleFloatState(mesh);
  }
  // Ensure turtle child stays flat for reuse
  if (mesh.itemType === "turtle" && mesh.userData && mesh.userData.turtle) {
    mesh.userData.turtle.rotation.set(-Math.PI / 2, 0, 0);
  }
  if (mesh.scale) mesh.scale.set(1, 1, 1);
}

// FIXME models passed as array?
function startGame(gameDuration, [boat /*, turtle, box*/], sounds, waternormals) {
  // renderer
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ARCADE_ENVIRONMENT.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  // Cross-browser WebGL context loss handlers
  try {
    const glCanvas = renderer.domElement;
    glCanvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      console.warn("WebGL context lost");
    }, false);
    glCanvas.addEventListener("webglcontextrestored", function () {
      console.warn("WebGL context restored");
    }, false);
  } catch (_) {}
  try {
    // Give focus to the canvas and drop focus from any inputs
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    renderer.domElement.setAttribute("tabindex", "0");
    renderer.domElement.style.outline = "none";
    renderer.domElement.focus({ preventScroll: true });
    if (window && window.focus) window.focus();
  } catch (_) {}

  sun = new THREE.Vector3();

  let dirLight;

  // camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );

  scene.add(boat);
  player = boat;
  player.userData.boatVisual = boat;
  boat.userData.baseRotX = boat.rotation.x || 0;
  boat.userData.baseRotY = boat.rotation.y || 0;
  boat.userData.baseRotZ = boat.rotation.z || 0;
  if (startPosition && typeof startPosition.x === "number" && typeof startPosition.z === "number") {
    player.position.set(startPosition.x, (startPosition.y || 0), startPosition.z);
  }
  // Power-up emoji badge above boat
  powerupBadge = createEmojiSprite("");
  powerupBadge.position.set(0, 0.9, 0);
  powerupBadge.visible = false;
  player.add(powerupBadge);
  // Do not render power-up badge in water reflection pass
  try { disableReflectionForSprite(powerupBadge); } catch (_) {}
  // Status badge (freeze/countdown) above boat
  statusBadge = createEmojiSprite("");
  statusBadge.position.set(0, 1.15, 0);
  statusBadge.visible = false;
  player.add(statusBadge);
  // Do not render status badge in water reflection pass
  try { disableReflectionForSprite(statusBadge); } catch (_) {}
  // No local name tag (only show names above other boats)

  // lights
  const ambientLight = new THREE.AmbientLight(ARCADE_ENVIRONMENT.ambientColor, ARCADE_ENVIRONMENT.ambientIntensity);
  player.add(ambientLight);
  const hemi = new THREE.HemisphereLight(
    ARCADE_ENVIRONMENT.hemisphereSkyColor,
    ARCADE_ENVIRONMENT.hemisphereGroundColor,
    ARCADE_ENVIRONMENT.hemisphereIntensity
  );
  scene.add(hemi);
  dirLight = new THREE.DirectionalLight(
    ARCADE_ENVIRONMENT.directionalColor,
    ARCADE_ENVIRONMENT.directionalIntensity
  );
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(
    ARCADE_ENVIRONMENT.fillColor,
    ARCADE_ENVIRONMENT.fillIntensity
  );
  fillLight.position.set(-120, 85, -90);
  scene.add(fillLight);

  // audio (autoplay-safe across browsers)
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const sound = new THREE.Audio(listener);
  try {
    if (sounds) sound.setBuffer(sounds);
  } catch (_) {}
  sound.setVolume(0.09);
  sound.setLoop(true);
  try {
    const p = sound.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {}

  // HUD sound toggle (autoplay-safe)
  let soundOn = !!(sound && sound.isPlaying);
  const soundBtn = document.getElementById("hud-sound-toggle");
  if (soundBtn) {
    soundBtn.textContent = soundOn ? "Sound: On" : "Sound: Off (click)";
    soundBtn.onclick = () => {
      soundOn = !soundOn;
      if (soundOn) {
        sound.setVolume(0.09);
        try { if (!sound.isPlaying) sound.play(); } catch (_) {}
        soundBtn.textContent = "Sound: On";
      } else {
        try { sound.pause(); } catch (_) {}
        soundBtn.textContent = "Sound: Off";
      }
    };
  }

  window.addEventListener("resize", function () {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Update environment once on resize instead of every frame
    skyNeedsEnvironmentRefresh = true;
    try { updateSun(); } catch (_) {}
  });

  // Pause audio when tab hidden (Firefox/others), resume on return
  document.addEventListener("visibilitychange", () => {
    try {
      if (document.hidden) {
        if (sound && sound.isPlaying) sound.pause();
      } else {
        if (soundBtn && soundOn) { try { sound.play(); } catch (_) {} }
      }
    } catch (_) {}
  });

  scene.add(camera);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 10, 0);
  controls.minDistance = 4.0;
  controls.maxDistance = 200.0;
  controls.update();

  // water (Three.js Water)
  const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
  if (waternormals && waternormals.isTexture) {
    waternormals.wrapS = THREE.RepeatWrapping;
    waternormals.wrapT = THREE.RepeatWrapping;
    waternormals.repeat.set(
      ARCADE_ENVIRONMENT.waterNormalRepeat,
      ARCADE_ENVIRONMENT.waterNormalRepeat
    );
    waternormals.needsUpdate = true;
  }
  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: waternormals,
    sunDirection: new THREE.Vector3(),
    sunColor: ARCADE_ENVIRONMENT.waterSunColor,
    waterColor: ARCADE_ENVIRONMENT.waterColor,
    distortionScale: ARCADE_ENVIRONMENT.waterDistortionScale,
    fog: scene.fog !== undefined,
  });
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // Skybox
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;
  skyUniforms["turbidity"].value = ARCADE_ENVIRONMENT.skyTurbidity;
  skyUniforms["rayleigh"].value = ARCADE_ENVIRONMENT.skyRayleigh;
  skyUniforms["mieCoefficient"].value = ARCADE_ENVIRONMENT.skyMieCoefficient;
  skyUniforms["mieDirectionalG"].value = ARCADE_ENVIRONMENT.skyMieDirectionalG;

  const parameters = {
    elevation: ARCADE_ENVIRONMENT.sunElevation,
    azimuth: ARCADE_ENVIRONMENT.sunAzimuth,
  };

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  let skyEnvironmentTexture = null;
  let skyNeedsEnvironmentRefresh = true;
  sun = new THREE.Vector3(0, 0, 0);

  function updateSun() {
    const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
    const theta = THREE.MathUtils.degToRad(parameters.azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    sky.material.uniforms["sunPosition"].value.copy(sun);
    if (water.material.uniforms && water.material.uniforms["sunDirection"]) {
      water.material.uniforms["sunDirection"].value.copy(sun).normalize();
    }
    if (dirLight) {
      dirLight.position.copy(sun).multiplyScalar(5000);
      dirLight.target.position.set(0, 0, 0);
      dirLight.target.updateMatrixWorld();
    }
    if (skyNeedsEnvironmentRefresh || !skyEnvironmentTexture) {
      if (skyEnvironmentTexture && typeof skyEnvironmentTexture.dispose === "function") {
        skyEnvironmentTexture.dispose();
      }
      skyEnvironmentTexture = pmremGenerator.fromScene(sky).texture;
      scene.environment = skyEnvironmentTexture;
      skyNeedsEnvironmentRefresh = false;
    }
  }

  const envProps = createArcadeEnvironmentProps(window.innerWidth < 800);
  environmentPropGroup = envProps.group;
  environmentPropStats = envProps.stats;
  scene.add(environmentPropGroup);

  let lastTrace = null;
  sendYourPosition = throttle(traceRateInMillis, () => {
    if (gameOverFlag) return;
    const { x, z } = player.position;
    const { y: rotY } = player.rotation;
    const trace = {
      id: yourId,
      x: Number(x.toFixed(3)),
      z: Number(z.toFixed(3)),
      rotY: Number(rotY.toFixed(4)),
    };
    const changed =
      !lastTrace ||
      Math.abs(trace.x - lastTrace.x) >= 0.02 ||
      Math.abs(trace.z - lastTrace.z) >= 0.02 ||
      Math.abs(trace.rotY - lastTrace.rotY) >= 0.01;
    if (changed) {
      worker.postMessage({ type: "player.trace.change", body: trace });
      lastTrace = trace;
    }
  });

  const navmeshGeometry = new THREE.PlaneGeometry(160, 255);
  const navmeshMaterial = new THREE.MeshBasicMaterial({
    color: 0x0000ff,
    opacity: 0,
    transparent: true,
    wireframe: false,
  });
  const navmesh = new THREE.Mesh(navmeshGeometry, navmeshMaterial);

  water.addEventListener("change", () => {
    navmesh.geometry = water.geometry.clone();
    navmesh.position.copy(water.position);
  });

  navmeshGeometry.rotateX(Math.PI / 2);
  scene.add(navmesh);

  // Particles (engine trail, splash, collision)
  const scale = window.innerWidth < 800 ? 0.6 : 1.0;
  emitters = createEmitters(scene, scale);

  // Timer UI: update both if present; default sink keeps one for legacy
  remainingTime = gameDuration;
  if (hudTimeEl) hudTimeEl.innerHTML = "Time: " + remainingTime;
  if (compactTimeEl) compactTimeEl.innerHTML = "Time: " + remainingTime;
  if (hudTimeEl) {
    timerDivRef = hudTimeEl;
  } else if (compactTimeEl) {
    timerDivRef = compactTimeEl;
  } else {
    const timerDiv = document.createElement("div");
    timerDiv.style.position = "absolute";
    timerDiv.style.top = "45px";
    timerDiv.style.left = "10px";
    timerDiv.style.color = "white";
    timerDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    timerDiv.innerHTML = "Time: " + remainingTime;
    document.body.appendChild(timerDiv);
    timerDivRef = timerDiv;
  }

  const hudVersion = document.getElementById("hud-version");
  if (hudVersion) {
    hudVersion.innerHTML = "Version: " + (serverVersion || "-");
  } else {
    const versionsDiv = document.createElement("div");
    versionsDiv.style.position = "absolute";
    versionsDiv.style.bottom = "10px";
    versionsDiv.style.right = "10px";
    versionsDiv.style.color = "white";
    versionsDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    versionsDiv.innerHTML = "Server: " + serverVersion;
    document.body.appendChild(versionsDiv);
  }

  speedElement = document.getElementById("hud-speed");
  if (!speedElement) {
    speedElement = document.createElement("div");
    speedElement.style.position = "absolute";
    speedElement.style.top = "65px";
    speedElement.style.left = "10px";
    speedElement.style.color = "white";
    speedElement.style.fontSize = "13px";
    speedElement.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    speedElement.innerHTML = "Speed: ";
    document.body.appendChild(speedElement);
  }

  // Power-up UI holder
  powerUpState.uiDiv = document.createElement("div");
  powerUpState.uiDiv.style.position = "absolute";
  powerUpState.uiDiv.style.top = "90px";
  powerUpState.uiDiv.style.left = "10px";
  powerUpState.uiDiv.style.color = "white";
  powerUpState.uiDiv.style.fontSize = "13px";
  powerUpState.uiDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  powerUpState.uiDiv.innerHTML = "Power-ups: none";
  document.body.appendChild(powerUpState.uiDiv);
  // Prefer in-world badge over HUD text for power-ups
  powerUpState.uiDiv.style.display = "none";

  function updatePowerUpUI() {
    const active = [];
    if (powerUpState.speedMultiplier > 1) active.push("Speed x" + powerUpState.speedMultiplier);
    if (powerUpState.shield) active.push("Shield");
    if (Date.now() < (powerUpState.magnetUntil || 0)) active.push("Magnet");
    if (Date.now() < (powerUpState.freezeUntil || 0)) active.push("Time Freeze");
    powerUpState.uiDiv.innerHTML = "Power-ups: " + (active.length ? active.join(", ") : "none");
    updatePowerUpBadge();
  }

  // server handles timer updates via "game.time"

  function restart() {
    restartBtn.style.display = "none";
    for (const [, mesh] of Object.entries(itemMeshes)) {
      if (mesh && mesh.isObject3D) scene.remove(mesh);
    }
    clearTrashInstances();
    clearPowerupInstances();
    player.position.set(0, 0, 0);
    localScore = 0;
    updateLocalScoreDisplays();
    remainingTime = remainingTime;
    if (timerDivRef) timerDivRef.innerHTML = "Time: " + remainingTime;
  }

  const scoreElement = document.getElementById("hud-score") || (function () {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.top = "10px";
    el.style.left = "10px";
    el.style.color = "white";
    el.style.fontSize = "24px";
    el.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    document.body.appendChild(el);
    return el;
  })();
  scoreElementRef = scoreElement;
  updateLocalScoreDisplays();

  const floatAmplitude = 0.1;
  const time = performance.now() * 0.0001;


  function animateItems() {
    const tSec = performance.now() * 0.001;
    const halfW = (boundaries?.width || 100) / 2 - 1;
    const halfH = (boundaries?.height || 100) / 2 - 1;
    const timeFreezeActive = Date.now() < (powerUpState.freezeUntil || 0);
    const dt = (frameDt || 0.016) * (timeFreezeActive ? POWERUP_FREEZE_OTHER_MULT : 1);
    const px = player ? player.position.x : 0;
    const pz = player ? player.position.z : 0;

    if (powerupInstances) {
      const bob = Math.sin(tSec * 2.4) * 0.03;
      for (const [itemId, entry] of powerupInstances.map.entries()) {
        const item = items[itemId];
        if (!item) continue;
        entry.rot += 0.6 * dt;
        const s = Number(item.size) || 1;
        powerupTmpScale.set(s, s, s);
        const ix = Number(item.position?.x) || 0;
        const iz = Number(item.position?.z) || 0;
        const waterY = typeof item.position?.y === "number" ? item.position.y : 0;
        powerupTmpPos.set(ix, waterY + 0.2 + bob, iz);
        powerupTmpEuler.set(0, entry.rot, 0);
        powerupTmpQuat.setFromEuler(powerupTmpEuler);
        powerupTmpMatrix.compose(powerupTmpPos, powerupTmpQuat, powerupTmpScale);
        powerupInstances.mesh.setMatrixAt(entry.idx, powerupTmpMatrix);
      }
      powerupInstances.mesh.instanceMatrix.needsUpdate = true;
    }

    if (trashInstances) {
      for (const [itemId, idx] of trashInstances.map.entries()) {
        const item = items[itemId];
        if (!item) continue;
        const s = Number(item.size) || 1;
        const ix = Number(item.position?.x) || 0;
        const iz = Number(item.position?.z) || 0;
        const waterY = typeof item.position?.y === "number" ? item.position.y : 0;
        trashTmpScale.set(s, s, s);
        trashTmpPos.set(ix, waterY + 0.2, iz);
        trashTmpMatrix.identity();
        trashTmpMatrix.compose(trashTmpPos, new THREE.Quaternion(), trashTmpScale);
        trashInstances.mesh.setMatrixAt(idx, trashTmpMatrix);
      }
      trashInstances.mesh.instanceMatrix.needsUpdate = true;
    }

    for (const [, mesh] of Object.entries(itemMeshes)) {
      if (!mesh || !mesh.isObject3D) continue;
      if (mesh.outOfBounds) continue;

      if (String(mesh.itemType || "") === "turtle") {
        applyLodForGroup(mesh);
        // Simple wandering AI within bounds
        if (!mesh.userData.ai) {
          mesh.userData.ai = {
            target: new THREE.Vector3(
              (Math.random() * 2 - 1) * halfW * 0.8,
              0,
              (Math.random() * 2 - 1) * halfH * 0.8
            ),
            speed: 0.45 + Math.random() * 0.25 // units/sec
          };
        }
        const ai = mesh.userData.ai;
        turtleTmpVec3.subVectors(ai.target, mesh.position);
        const dist = Math.max(0.00001, turtleTmpVec2.set(turtleTmpVec3.x, turtleTmpVec3.z).length());
        // pick new target when close
        if (dist < 1.0) {
          ai.target.set(
            (Math.random() * 2 - 1) * halfW * 0.8,
            0,
            (Math.random() * 2 - 1) * halfH * 0.8
          );
        } else {
          // Move towards target
          const step = Math.min(dist, ai.speed * dt);
          const moveX = (turtleTmpVec3.x / dist) * step;
          const moveZ = (turtleTmpVec3.z / dist) * step;
          mesh.position.x += moveX;
          mesh.position.z += moveZ;

          // Clamp inside playable area
          mesh.position.x = Math.max(-halfW, Math.min(halfW, mesh.position.x));
          mesh.position.z = Math.max(-halfH, Math.min(halfH, mesh.position.z));

          // Face movement direction with shortest-angle smoothing.
          if (Math.abs(moveX) + Math.abs(moveZ) > 0.0001) {
            const yaw = Math.atan2(moveX, moveZ);
            const yawDelta = ((yaw - mesh.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
            mesh.rotation.y += yawDelta * Math.min(1, dt * TURTLE_TURN_RESPONSE);
          }
        }

        const wave = getHeightAndNormal(mesh.position.x, mesh.position.z, tSec);
        const phase = mesh.userData.floatOffset || 0;
        const floatSpeed = mesh.userData.floatSpeed || TURTLE_BOB_SPEED_MIN;
        const floatAmplitude = mesh.userData.floatAmplitude || TURTLE_BOB_AMPLITUDE_MIN;
        const downwardBob = -Math.abs(Math.sin(tSec * floatSpeed + phase)) * floatAmplitude;
        const targetY = (wave.height || 0) + TURTLE_WATERLINE_OFFSET + downwardBob;
        mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, targetY, TURTLE_VERTICAL_LERP);
        applyTilt(mesh, wave.normal, 0.5, 0.045);
      } else {
        // Simple idle bobbing for non-turtles above the water line
        const t = tSec;
        const sinValue = Math.sin(t * 2 + mesh.position.x * 0.5 + mesh.position.z * 0.3);
        const baseY = 0.07;
        const amp = 0.08;
        mesh.position.y = baseY + sinValue * amp;
      }

      // Keep power-up idle spin
      if (String(mesh.itemType || "").startsWith("powerup_")) {
        mesh.rotation.y += 0.01;
      }
    }
  }

  function setKey(e, val) {
    const code = e.code;
    const key = e.key;
    keyboard[code] = val;
    keyboard[key] = val;
    switch (code) {
      case "ArrowUp":
      case "KeyW":
        keyboard["ArrowUp"] = val;
        break;
      case "ArrowDown":
      case "KeyS":
        keyboard["ArrowDown"] = val;
        break;
      case "ArrowLeft":
      case "KeyA":
        keyboard["ArrowLeft"] = val;
        break;
      case "ArrowRight":
      case "KeyD":
        keyboard["ArrowRight"] = val;
        break;
      default:
        break;
    }
  }
  document.addEventListener("keydown", function (e) {
    setKey(e, true);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  });
  document.addEventListener("keyup", function (e) {
    setKey(e, false);
  });

  let playerSpeed = 0;

  // Replay Oracle (Oracle JSON-style replay clips around key events)
  const REPLAY_BEFORE_FRAMES = 30;
  const REPLAY_AFTER_FRAMES = 30;
  const REPLAY_RING_CAPACITY = 240;
  let __replayRing = [];
  let __pendingReplay = null; // { event, frames: [], afterRemaining }
  let __replayQueue = [];
  const __replays = [];
  // expose for debugging/inspection
  try {
    window.__replays = __replays;
    window.downloadLatestReplay = function () {
      if (!__replays.length) { console.warn("No replays captured yet."); return; }
      const doc = __replays[__replays.length - 1];
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date(doc.event.at || Date.now()).toISOString().replace(/[:.]/g, "-");
      a.download = `oracle-replay-${doc.event.type}-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
  } catch (_) {}

  function __effectiveSpeedForFrame() {
    try {
      if (serverAuthEnabled && authStates && authStates[yourId] && typeof authStates[yourId].speed === "number") {
        return Math.abs(authStates[yourId].speed);
      }
    } catch (_) {}
    return typeof playerSpeed === "number" ? playerSpeed : 0;
  }

  function __frameSnapshot() {
    const pos = player ? { x: Number(player.position.x || 0), y: Number(player.position.y || 0), z: Number(player.position.z || 0) } : { x: 0, y: 0, z: 0 };
    const rotY = player ? Number(player.rotation.y || 0) : 0;
    const spd = __effectiveSpeedForFrame();
    const ts = Date.now();
    const throttle = Math.max(-1, Math.min(1, (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0) + Number(mobileInput.throttle || 0)));
    const steer = Math.max(-1, Math.min(1, (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0) + Number(mobileInput.steer || 0)));
    return {
      ts,
      timeISO: new Date(ts).toISOString(),
      room: roomId || null,
      player: { id: yourId, name: playerName || localStorage.getItem("yourName") || "Default" },
      state: {
        position: pos,
        rotY,
        speed: spd,
        score: Number(localScore || 0),
        remainingTime: Number(remainingTime || 0),
        input: { throttle, steer }
      }
    };
  }

  function __pushReplayFrame() {
    const f = __frameSnapshot();
    if (__replayRing.length >= REPLAY_RING_CAPACITY) __replayRing.shift();
    __replayRing.push(f);
    if (__pendingReplay) {
      __pendingReplay.frames.push(f);
      __pendingReplay.afterRemaining -= 1;
      if (__pendingReplay.afterRemaining <= 0) {
        const doc = {
          oracleReplay: true,
          version: 1,
          serverVersion: serverVersion || null,
          sessionId: currentSessionId || `${roomId || "ROOM"}:${yourId}:pending`,
          room: roomId || null,
          player: { id: yourId, name: playerName || localStorage.getItem("yourName") || "Default" },
          event: __pendingReplay.event, // { type, at, meta }
          clip: {
            before: REPLAY_BEFORE_FRAMES,
            after: REPLAY_AFTER_FRAMES,
            frames: __pendingReplay.frames
          }
        };
        __replays.push(doc);
        try {
          console.info("[ReplayOracle] Clip ready", doc);
          try {
            if (navigator && typeof navigator.sendBeacon === "function") {
              const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
              navigator.sendBeacon("/api/replay/events", blob);
            } else {
              fetch("/api/replay/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(doc),
                keepalive: true
              }).catch(() => {});
            }
          } catch (_) {}
        } catch (_) {}
        __pendingReplay = null;
        if (__replayQueue.length) {
          __startReplayCapture(__replayQueue.shift());
        }
      }
    }
  }

  function __startReplayCapture(event) {
    const startIdx = Math.max(0, __replayRing.length - REPLAY_BEFORE_FRAMES);
    const beforeFrames = __replayRing.slice(startIdx);
    __pendingReplay = { event, frames: beforeFrames.slice(), afterRemaining: REPLAY_AFTER_FRAMES };
  }

  function triggerReplayMoment(type, meta) {
    const evt = { type: String(type || "event"), at: new Date().toISOString(), meta: meta || {} };
    if (__pendingReplay) {
      __replayQueue.push(evt);
    } else {
      __startReplayCapture(evt);
    }
  }
  triggerReplayMomentCallback = triggerReplayMoment;

  const navmeshBoundingBox = new THREE.Box3().setFromObject(navmesh);

  function applyPowerUp(type) {
    if (type === "powerup_speed") {
      powerUpState.speedMultiplier = 2;
      if (powerUpState.timers.speed) clearTimeout(powerUpState.timers.speed);
      powerUpState.timers.speed = setTimeout(() => {
        powerUpState.speedMultiplier = 1;
        updatePowerUpUI();
      }, 10000);
      updatePowerUpUI();
    } else if (type === "powerup_shield") {
      powerUpState.shield = true;
      if (powerUpState.timers.shield) clearTimeout(powerUpState.timers.shield);
      powerUpState.timers.shield = setTimeout(() => {
        powerUpState.shield = false;
        updatePowerUpUI();
      }, 5000);
      updatePowerUpUI();
    } else if (type === "powerup_magnet") {
      powerUpState.magnetUntil = Date.now() + 8000;
      if (powerUpState.timers.magnet) clearTimeout(powerUpState.timers.magnet);
      powerUpState.timers.magnet = setTimeout(() => {
        powerUpState.magnetUntil = 0;
        updatePowerUpUI();
      }, 8000);
      updatePowerUpUI();
    } else if (type === "powerup_freeze") {
      powerUpState.freezeUntil = Date.now() + 4000;
      if (powerUpState.timers.freeze) clearTimeout(powerUpState.timers.freeze);
      powerUpState.timers.freeze = setTimeout(() => {
        powerUpState.freezeUntil = 0;
        updatePowerUpUI();
      }, 4000);
      updatePowerUpUI();
    }
  }
  applyPowerUpEffect = applyPowerUp;

  function checkCollisions() {
    clearStalePendingItemCollisions();
    const playerBox = new THREE.Box3().setFromObject(player);
    const trashBox = new THREE.Box3();
    const trashCenter = new THREE.Vector3();
    const trashSize = new THREE.Vector3();
    const magnetActive = Date.now() < (powerUpState.magnetUntil || 0);
    const magnetRadius = magnetActive ? POWERUP_MAGNET_RADIUS : 0;

    for (const [key, item] of Object.entries(items || {})) {
      if (!item) continue;
      if (isMarineLife(item.type) || isPowerUp(item.type)) continue;
      if (!trashInstances || !trashInstances.map.has(key)) continue;
      if (pendingItemCollisions.has(key)) continue;

      const s = Number(item.size) || 1;
      const px = Number(item.position && item.position.x) || 0;
      const pz = Number(item.position && item.position.z) || 0;
      const py = (typeof item.position?.y === "number" ? item.position.y : 0) + 0.08;
      trashCenter.set(px, py, pz);
      trashSize.set(s, s, s);
      trashBox.setFromCenterAndSize(trashCenter, trashSize);
      if (!playerBox.intersectsBox(trashBox)) {
        if (!magnetActive) continue;
        const dx = (player.position?.x || 0) - px;
        const dz = (player.position?.z || 0) - pz;
        if (Math.hypot(dx, dz) > magnetRadius) continue;
      }

      if (!markItemCollisionPending(key, item.type || "trash")) continue;

      const collisionData = {
        itemId: key,
        localScore,
        playerId: yourId,
        playerName: playerName,
      };

      worker.postMessage({
        type: "items.collision",
        body: collisionData,
      });

      if (emitters) emitters.collision.trigger(player.position);
    }

    for (const [key, item] of Object.entries(items || {})) {
      if (!item) continue;
      if (!isPowerUp(item.type)) continue;
      if (!powerupInstances || !powerupInstances.map.has(key)) continue;
      if (pendingItemCollisions.has(key)) continue;

      const s = Number(item.size) || 1;
      const px = Number(item.position && item.position.x) || 0;
      const pz = Number(item.position && item.position.z) || 0;
      const py = (typeof item.position?.y === "number" ? item.position.y : 0) + 0.08;
      trashCenter.set(px, py, pz);
      trashSize.set(s, s, s);
      trashBox.setFromCenterAndSize(trashCenter, trashSize);
      if (!playerBox.intersectsBox(trashBox)) {
        if (!magnetActive) continue;
        const dx = (player.position?.x || 0) - px;
        const dz = (player.position?.z || 0) - pz;
        if (Math.hypot(dx, dz) > magnetRadius) continue;
      }

      if (!markItemCollisionPending(key, item.type)) continue;

      const collisionData = {
        itemId: key,
        localScore,
        playerId: yourId,
        playerName: playerName,
      };

      worker.postMessage({
        type: "items.collision",
        body: collisionData,
      });
      if (emitters) emitters.collision.trigger(player.position);
    }

    for (const [key, mesh] of Object.entries(itemMeshes)) {
      if (!mesh || !mesh.isObject3D) continue;
      if (mesh.outOfBounds) continue;
      if (pendingItemCollisions.has(key)) continue;

      const itemMeshBox = new THREE.Box3().setFromObject(mesh);
      let collision = playerBox.intersectsBox(itemMeshBox);
      if (!collision && magnetActive && !isMarineLife(mesh.itemType)) {
        const dx = (player.position?.x || 0) - (mesh.position?.x || 0);
        const dz = (player.position?.z || 0) - (mesh.position?.z || 0);
        if (Math.hypot(dx, dz) <= magnetRadius) collision = true;
      }
      if (!collision) continue;

      // Shield: ignore marine life penalty and do not remove the turtle
      if (isMarineLife(mesh.itemType) && powerUpState.shield) {
        continue;
      }

      // For trash and power-ups, remove on collision
      if (!markItemCollisionPending(key, mesh.itemType)) continue;

      const collisionData = {
        itemId: key,
        localScore,
        playerId: yourId,
        playerName: playerName,
      };

      if (String(mesh.itemType || "").startsWith("powerup_")) {
        // Notify server to remove the power-up
        worker.postMessage({
          type: "items.collision",
          body: collisionData,
        });
        if (emitters) emitters.collision.trigger(player.position);
        continue;
      }

      // Trash or marine life default behavior
      if (mesh.animationActions) {
        mesh.playingAnimationsCount = mesh.animationActions.length;
        mesh.animationActions.forEach((action) => action.play());
      }

      worker.postMessage({
        type: "items.collision",
        body: collisionData,
      });

      if (emitters) emitters.collision.trigger(player.position);

    }
  }


  function updatePlayerPosition() {
    if (!player || !water || gameOverFlag) return;

    // Freeze controls during synchronized STARTING countdown (authoritative)
    if (gameState === "STARTING") {
      const targetCameraPosition = new THREE.Vector3();
      const sphericalCoords = new THREE.Spherical(
        2,
        Math.PI / 2,
        player.rotation.y + Math.PI
      );
      targetCameraPosition.setFromSpherical(sphericalCoords);
      targetCameraPosition.y += 0.5;
      targetCameraPosition.add(player.position);
      camera.position.lerp(targetCameraPosition, 0.1);
      camera.lookAt(player.position);
      if (statusBadge) { setSpriteText(statusBadge, ""); statusBadge.visible = false; }
      playerSpeed = 0;
      return;
    }

    // Freeze handling: disable movement while frozen, keep camera following
    if (Date.now() < freezeUntilMs) {
      const left = Math.ceil((freezeUntilMs - Date.now()) / 1000);
      if (freezeDiv) freezeDiv.innerHTML = "Frozen: " + left + "s";
      playerSpeed = 0;

      const targetCameraPosition = new THREE.Vector3();
      const sphericalCoords = new THREE.Spherical(
        2,
        Math.PI / 2,
        player.rotation.y + Math.PI
      );
      targetCameraPosition.setFromSpherical(sphericalCoords);
      targetCameraPosition.y += 0.5;
      targetCameraPosition.add(player.position);
      camera.position.lerp(targetCameraPosition, 0.1);
      camera.lookAt(player.position);
      updatePowerUpBadge();
      updateFrozenIndicators();
      return;
    } else if (freezeDiv) {
      freezeDiv.innerHTML = "";
      updatePowerUpBadge();
      updateFrozenIndicators();
    }

    // Align client physics with server defaults for visible motion
    const phys = serverPhysics || {
      acceleration: 6,
      brake: 3,
      maxSpeed: 3,
      friction: 1.5,
      turnSpeed: 0.523599,
      driftFactor: 0
    };
    const ACCELERATION_BASE = phys.acceleration;
    const BRAKE = phys.brake;
    const MAX_SPEED_BASE = phys.maxSpeed;
    const FRICTION = phys.friction;
    const TURN_SPEED = phys.turnSpeed;
    const DRIFT_FACTOR = phys.driftFactor || 0;

    let ACCELERATION = ACCELERATION_BASE * powerUpState.speedMultiplier;
    let MAX_SPEED = MAX_SPEED_BASE * powerUpState.speedMultiplier;

    const dt = frameDt || 0.016;
    const nowMs = performance.now();
    const lagMs = serverAuthEnabled ? (nowMs - (authStatesTime || 0)) : 0;
    const authFreshGlobal = serverAuthEnabled && authStates && lagMs <= SNAPSHOT_STALE_MS;
    const authFreshForYou = !!(authFreshGlobal && authStates && authStates[yourId]);
    const movement = new THREE.Vector3(0, 0, 0);
    const lateralVelocity = new THREE.Vector3(0, 0, 0);
    const throttle = Math.max(-1, Math.min(1, (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0) + Number(mobileInput.throttle || 0)));
    const steer = Math.max(-1, Math.min(1, (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0) + Number(mobileInput.steer || 0)));
    if (serverAuthEnabled) {
      inputSeq++;
      worker.postMessage({
        type: "player.input",
        body: { id: yourId, seq: inputSeq, throttle, steer, brake: throttle < 0 }
      });
    }
    // Slight boost while predicting locally for clearer motion in client-only/lagged mode
    if (!serverAuthEnabled || !authFreshForYou) {
      ACCELERATION *= 1.15;
      MAX_SPEED *= 1.2;
    }

    if (!serverAuthEnabled || !authFreshForYou) {
      if (throttle > 0) {
        playerSpeed += ACCELERATION * throttle * dt;
      } else if (throttle < 0) {
        playerSpeed -= BRAKE * (-throttle) * dt;
      }
    }

    if ((!serverAuthEnabled || !authFreshForYou) && steer !== 0) {
      player.rotation.y += TURN_SPEED * steer * dt;
      if (keyboard["ArrowUp"]) {
        playerSpeed *= Math.exp(-FRICTION * dt);
      }
    }

    if ((!serverAuthEnabled || !authFreshForYou) && !keyboard["ArrowUp"] && !keyboard["ArrowDown"]) {
      playerSpeed *= Math.exp(-FRICTION * dt);
    }


    if (!serverAuthEnabled || !authFreshForYou) {
      playerSpeed = Math.max(Math.min(playerSpeed, MAX_SPEED), -MAX_SPEED);
      if (speedElement) {
        speedElement.innerHTML = `Speed: ${playerSpeed.toFixed(2)}`;
      }
      if (compactSpeedEl) {
        compactSpeedEl.innerHTML = `Speed: ${playerSpeed.toFixed(2)}`;
      }
    } else {
      const s = authStates && authStates[yourId];
      const shown = s && typeof s.speed === "number" ? Math.abs(s.speed) : 0;
      if (speedElement) {
        speedElement.innerHTML = `Speed: ${shown.toFixed(2)}`;
      }
      if (compactSpeedEl) {
        compactSpeedEl.innerHTML = `Speed: ${shown.toFixed(2)}`;
      }
    }

    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(
      player.quaternion
    );

    const CAMERA_DISTANCE = 2;
    const CAMERA_HEIGHT = 0.5;
    const SPRING_STRENGTH = 0.1;

    const lastPosition = player.position.clone();
    if (!serverAuthEnabled || !authFreshForYou) {
      player.position.addScaledVector(direction, playerSpeed * dt);
    }

    // 2D bounds check against world boundaries (ignore Y thickness)
    const halfW = (boundaries?.width || 100) / 2;
    const halfH = (boundaries?.height || 100) / 2;
    if (
      player.position.x < -halfW || player.position.x > halfW ||
      player.position.z < -halfH || player.position.z > halfH
    ) {
      player.position.copy(lastPosition);
    }

    const targetCameraPosition = new THREE.Vector3();
    const sphericalCoords = new THREE.Spherical(
      CAMERA_DISTANCE,
      Math.PI / 2,
      player.rotation.y + Math.PI
    );
    targetCameraPosition.setFromSpherical(sphericalCoords);
    targetCameraPosition.y += CAMERA_HEIGHT;
    targetCameraPosition.add(player.position);
    camera.position.lerp(targetCameraPosition, SPRING_STRENGTH);
    camera.lookAt(player.position);

    // Reconcile local player to authoritative server state (smoothly)
    if (authFreshForYou) {
      const s = authStates[yourId];
      const target = new THREE.Vector3(s.x, player.position.y, s.z);
      player.position.lerp(target, 0.2);
      // shortest-angle lerp for yaw
      const delta = ((s.rotY - player.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.rotation.y += delta * 0.2;
    }
    // Leave a trail point for the local player
    addTrailPoint(yourId, player.position);
    // Emit engine particles based on speed
    if (emitters && Math.abs(playerSpeed) > 0.0001) {
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
      // Emit engine particles from 1m beneath the boat center (at/near root)
      const exhaustLocal = new THREE.Vector3(0, -1.0, 0);
      const exhaustPos = exhaustLocal.applyQuaternion(player.quaternion).add(player.position);
      emitters.engine.emitAt(exhaustPos, dir, 1 + Math.abs(playerSpeed) * 150);
      // Water splash when steering at speed; spawn near stern but anchored under hull
      if (Math.abs(playerSpeed) > 0.01 && (keyboard["ArrowLeft"] || keyboard["ArrowRight"])) {
        const splashLocal = new THREE.Vector3(0, -1.0, -0.3);
        const splashPos = splashLocal.applyQuaternion(player.quaternion).add(player.position);
        emitters.splash.trigger(splashPos, 6);
      }
    }
  }

  function animateOtherPlayers(playerMeshes) {
    if (!playerMeshes) return;
    const timeFreezeActive = Date.now() < (powerUpState.freezeUntil || 0);
    const lerpFactor = timeFreezeActive ? 0.12 : 0.35;
    if (serverAuthEnabled && authStates) {
      Object.keys(playerMeshes).forEach((id) => {
        if (id === yourId) return;
        const s = authStates[id];
        if (!s) return;
        const m = playerMeshes[id];
        if (!m) return;
        // Smoothly approach authoritative state
        m.position.x = THREE.MathUtils.lerp(m.position.x, s.x, lerpFactor);
        m.position.z = THREE.MathUtils.lerp(m.position.z, s.z, lerpFactor);
        const delta = ((s.rotY - m.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
        m.rotation.y += delta * lerpFactor;
        // Trail for remote players
        addTrailPoint(id, m.position);
      });
      return;
    }
    // Fallback to legacy traces
    Object.keys(playerMeshes).forEach((id) => {
      if (otherPlayers[id]) {
        playerMeshes[id].position.x = THREE.MathUtils.lerp(playerMeshes[id].position.x, otherPlayers[id].x, lerpFactor);
        playerMeshes[id].position.z = THREE.MathUtils.lerp(playerMeshes[id].position.z, otherPlayers[id].z, lerpFactor);
        const delta = ((otherPlayers[id].rotY - playerMeshes[id].rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
        playerMeshes[id].rotation.y += delta * lerpFactor;
        applyLodForGroup(playerMeshes[id]);
        // Leave a trail point for remote players
        addTrailPoint(id, playerMeshes[id].position);
      }
    });
  }

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = (now - lastFrameTs) / 1000;
    lastFrameTs = now;
    frameDt = dt;
    const frameMs = dt * 1000;
    smoothedFrameMs = smoothedFrameMs * 0.9 + frameMs * 0.1;
    if (hudDebugEl) {
      const nowDbg = performance.now();
      const lag = serverAuthEnabled ? Math.max(0, Math.round(nowDbg - (authStatesTime || nowDbg))) : 0;
      const th = (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0);
      const st = (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0);
      const sp = typeof playerSpeed === "number" ? playerSpeed.toFixed(2) : "0.00";
      const px = player ? player.position.x.toFixed(2) : "0.00";
      const pz = player ? player.position.z.toFixed(2) : "0.00";
      const netQ = networkStats.quality || "unknown";
      const netRtt = networkStats.rttMs != null ? `${networkStats.rttMs}ms` : "-";
      const netUp = `${(Number(networkStats.upKbps) || 0).toFixed(1)}k`;
      const netDown = `${(Number(networkStats.downKbps) || 0).toFixed(1)}k`;
      const fps = Number.isFinite(renderStats.fps) ? renderStats.fps.toFixed(1) : "-";
      const draws = Number.isFinite(renderStats.drawCalls) ? renderStats.drawCalls : "-";
      const tris = Number.isFinite(renderStats.triangles) ? Math.round(renderStats.triangles / 1000) : "-";
      hudDebugEl.innerText = `Auth: ${serverAuthEnabled ? "on" : "off"} | admin: ${isAdmin ? "yes" : "no"} | lag: ${lag}ms | fps:${fps} draw:${draws} tri:${tris}k | net:${netQ}/${netRtt} up:${netUp} down:${netDown} | cull:${lastCullingNodeCount} | th:${th} st:${st} sp:${sp} pos:${px},${pz}`;
    }
    if (emitters) emitters.update(dt);
    updatePlayerPosition();
    if (gameState === "RUNNING" && player && now - lastPositionEventAt > 2000) {
      lastPositionEventAt = now;
      emitGameplayEvent("position_sample", {
        speed: Number(__effectiveSpeedForFrame() || 0),
        input: {
          throttle: (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0) + Number(mobileInput.throttle || 0),
          steer: (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0) + Number(mobileInput.steer || 0),
        },
      });
    }
    if (gameState === "RUNNING") {
      checkCollisions();
      // Check collisions with other players' trails (Tron-like)
      checkTrailCollisionsWithPlayer();
    }
    cleanupOldTrails();
    __pushReplayFrame();
    render();
    if ((now - lastClientMonitorUpdateAt) > 250) {
      lastClientMonitorUpdateAt = now;
      updateNetworkMonitorOnly();
    }
    // Throttle sky/PMREM updates for Firefox/low-end GPUs
    if (!window.__lastSunUpdate) window.__lastSunUpdate = 0;
    if ((now - window.__lastSunUpdate) > 1000) { updateSun(); window.__lastSunUpdate = now; }
    animateItems();
    if (gameState !== "STARTING" && !serverAuthEnabled && sendYourPosition) sendYourPosition();
    animateOtherPlayers(otherPlayersMeshes);
  }

  const frustum = new THREE.Frustum();
  const cullMatrix = new THREE.Matrix4();
  const tmpBox = new THREE.Box3();
  const tmpWorldBox = new THREE.Box3();
  const cullCandidates = [];
  const tmpColor = new THREE.Color();
  let cullRebuildCounter = 0;
  animate();

  function render() {
    // Update water time uniform (Three.js Water shader)
    water.material.uniforms["time"].value += ARCADE_ENVIRONMENT.waterTimeStep;

    // Frustum culling
    camera.updateMatrixWorld();
    cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(cullMatrix);

    // Cull items/players using octree spatial partitioning + frustum query
    window.__cullFrame = (window.__cullFrame | 0) + 1;
    if ((window.__cullFrame % 3) === 0) {
      cullRebuildCounter++;
      cullCandidates.length = 0;
      Object.values(itemMeshes).forEach((m) => { if (m) cullCandidates.push(m); });
      Object.values(otherPlayersMeshes).forEach((g) => { if (g) cullCandidates.push(g); });

      if (cullCandidates.length) {
        tmpWorldBox.makeEmpty();
        for (const m of cullCandidates) {
          tmpBox.setFromObject(m);
          tmpWorldBox.union(tmpBox);
        }
        tmpWorldBox.min.x -= 4; tmpWorldBox.min.y -= 4; tmpWorldBox.min.z -= 4;
        tmpWorldBox.max.x += 4; tmpWorldBox.max.y += 4; tmpWorldBox.max.z += 4;
        if (!cullingOctree || (cullRebuildCounter % 15) === 1) {
          cullingOctree = new SpatialOctree(tmpWorldBox, { maxDepth: 5, capacity: 20 });
        } else {
          cullingOctree.clear();
          cullingOctree.root.box.copy(tmpWorldBox);
        }
        for (const m of cullCandidates) {
          tmpBox.setFromObject(m);
          cullingOctree.insertBox(tmpBox, { mesh: m, uuid: m.uuid });
        }
        const visibleEntries = cullingOctree.queryFrustum(frustum);
        const visibleUuids = new Set(visibleEntries.map((e) => e.uuid));
        lastCullingNodeCount = visibleEntries.length;
        for (const m of cullCandidates) {
          m.visible = visibleUuids.has(m.uuid);
        }
      }

      if (cullingDebugEnabled) {
        for (const m of cullCandidates) {
          let helper = cullingHelpers.get(m.uuid);
          if (!helper) {
            helper = new THREE.BoxHelper(m, 0x00ff00);
            helper.userData.meshUuid = m.uuid;
            cullingHelpers.set(m.uuid, helper);
            scene.add(helper);
          }
          tmpColor.set(m.visible ? 0x00ff00 : 0xff3333);
          helper.material.color.copy(tmpColor);
          helper.visible = true;
          helper.update();
        }
        for (const [uuid, helper] of cullingHelpers.entries()) {
          const meshAlive = cullCandidates.some((m) => m && m.uuid === uuid);
          if (!meshAlive || !cullingDebugEnabled) {
            try { scene.remove(helper); } catch (_) {}
            cullingHelpers.delete(uuid);
          }
        }
      }
    }

    renderer.render(scene, camera);
  }
}

function isMarineLife(type) {
  switch (type) {
    case "turtle":
      return true;
    case "trash":
      return false;
    default:
      return false;
  }
}

function isPowerUp(type) {
  return String(type || "").startsWith("powerup_");
}

function endGame() {
  stopLocalTimeTicker();
  emitGameplayEvent("game_over", {
    final_score: Number(localScore || 0),
    time_remaining: Number(remainingTime || 0),
    stats: { ...eventStats },
    powerups_active_at_end: {
      speed: Number(powerUpState.speedMultiplier || 1),
      shield: !!powerUpState.shield,
      magnet: Date.now() < (powerUpState.magnetUntil || 0),
      freeze: Date.now() < (powerUpState.freezeUntil || 0),
    },
  });
  gameOverFlag = true;
  keyboard = {};
  mobileInput = { throttle: 0, steer: 0, active: false };
  clearCullingDebugHelpers(scene);

  for (const [, mesh] of Object.entries(itemMeshes)) {
    if (mesh && mesh.isObject3D) scene.remove(mesh);
  }
  clearTrashInstances();
  clearPowerupInstances();
  // Cleanup trails and freeze UI
  for (const t of Object.values(trails)) {
    scene.remove(t.line);
  }
  trails = {};
  freezeUntilMs = 0;
  if (freezeDiv) {
    freezeDiv.remove();
    freezeDiv = null;
  }

  // Populate results screen instead of creating ad-hoc overlays
  const rn = document.getElementById("results-name");
  if (rn) rn.textContent = "Name: " + (playerName || "Default");
  const rs = document.getElementById("results-score");
  if (rs) rs.textContent = "Score: " + localScore;
  let rc = document.getElementById("results-commentary");
  if (!rc) {
    const summary = document.getElementById("results-summary");
    if (summary) {
      rc = document.createElement("div");
      rc.id = "results-commentary";
      rc.className = "results-commentary";
      summary.appendChild(rc);
    }
  }
  if (rc) rc.textContent = "Commentary is being drafted...";

  setPhase("POST_GAME");
  clearTimeout(timerId);
}

// UI helpers
function showWaiting() {
  setPhase("LOBBY");
}

function showStarting() {
  setPhase("STARTING");
  startCountdown(10000);
}

function hideMessages() {
  clearCountdown();
}

function renderGameToText() {
  const turtleSamples = Object.values(itemMeshes || {})
    .filter((mesh) => mesh && String(mesh.itemType || "") === "turtle" && mesh.visible !== false)
    .slice(0, 3)
    .map((mesh) => ({
      x: Number((mesh.position?.x || 0).toFixed(3)),
      y: Number((mesh.position?.y || 0).toFixed(3)),
      z: Number((mesh.position?.z || 0).toFixed(3)),
      rotY: Number((mesh.rotation?.y || 0).toFixed(3)),
    }));
  const payload = {
    mode: gameState,
    coordinateSystem: "World origin is center; +x right, +z forward, +y up",
    player: player
      ? { x: Number(player.position.x || 0), y: Number(player.position.y || 0), z: Number(player.position.z || 0) }
      : null,
    score: Number(localScore || 0),
    timeRemaining: Number(remainingTime || 0),
    playersVisible: Object.keys(otherPlayers || {}).length,
    itemsVisible: Object.keys(items || {}).length,
    trashInstances: trashInstances && trashInstances.map ? trashInstances.map.size : 0,
    powerupInstances: powerupInstances && powerupInstances.map ? powerupInstances.map.size : 0,
    environmentPropsVisible: environmentPropStats.total || 0,
    turtlesVisible: turtleSamples.length,
    turtleSamples,
    powerUps: {
      speed: Number(powerUpState.speedMultiplier || 1),
      shield: !!powerUpState.shield,
      magnet: Date.now() < (powerUpState.magnetUntil || 0),
      freeze: Date.now() < (powerUpState.freezeUntil || 0),
    },
  };
  return JSON.stringify(payload);
}

window.render_game_to_text = renderGameToText;
window.advanceTime = async (ms) => {
  const delay = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  await new Promise((resolve) => setTimeout(resolve, delay));
};
