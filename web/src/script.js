import short from "shortid";
import * as THREE from "three";
import { MathUtils } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { throttle } from "throttle-debounce";
import { preloadAssets, progressivePreload } from "./assets";
import { createEmitters } from "./particles";
import { getHeightAndNormal, applyTilt } from "./buoyancy";
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

if (!localStorage.getItem("yourId")) {
  localStorage.setItem("yourId", short());
}
const yourId = localStorage.getItem("yourId");
let playerName;

let renderer, scene, camera, sun, water;
let canvas;
let player, controls;
let emitters = null;
let lastFrameTs = performance.now();
let frameDt = 0;
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
  LOBBY: "LOBBY",
  STARTING: "STARTING",
  GAMEPLAY: "GAMEPLAY",
  ENDED: "ENDED",
  POST_GAME: "POST_GAME",
};

function setPhase(phase) {
  currentPhase = phase;
  renderUI();
  try { if (typeof updateControls === "function") updateControls(); } catch (_) {}
}

function renderUI() {
  const overlay = document.getElementById("overlay");
  const screens = {
    ACCESS: document.getElementById("screen-access"),
    MENU: document.getElementById("screen-menu"),
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
  setPhase("MENU");
}

function showLobby() {
  setPhase("LOBBY");
}

function showPostGame() {
  setPhase("POST_GAME");
}

// Rooms and lifecycle ownership
let roomId = null;
let isAdmin = false;
let roomsDirectory = null;       // { default, rooms[], ts }
let pendingRoomJoinId = null;    // queued join before worker init
let roomJoinedAck = false;       // true after server confirms room.joined
let pendingStartRequested = false; // start requested before room ack

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
  const canStartNow = inLobby && currentPhase !== "STARTING" && currentPhase !== "GAMEPLAY";
  const canStartEffective = canStartNow && roomJoinedAck;
  if (createBtn) createBtn.disabled = inPlay || currentPhase === "STARTING";          // cannot create while playing or during countdown
  if (joinBtn) joinBtn.disabled = inPlay || currentPhase === "STARTING";              // cannot join while playing or during countdown
  if (startBtn) startBtn.disabled = !canStartEffective;
  const lobbyStartBtnCtrl = document.getElementById("btn-lobby-start");
  if (lobbyStartBtnCtrl) lobbyStartBtnCtrl.disabled = !canStartEffective;
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
  timers: {},
  uiDiv: null,
};

lobby.getLeaderBoard();

let gameInitialized = false;
let clientGameStarted = false;
let uiBound = false;

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

function bindGlobalUI() {
  if (uiBound) return;
  uiBound = true;

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
      currentPhase = "MAIN_MENU";
      init();
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
    accessContinueBtn.addEventListener("click", () => {
      const inputEl = document.getElementById("name-input");
      const name = (inputEl && inputEl.value && inputEl.value.trim()) || localStorage.getItem("yourName") || "Default";
      playerName = name;
      localStorage.setItem("yourName", name);
      setPhase("MENU");
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
  const lobbyStartBtn = document.getElementById("btn-lobby-start");
  if (lobbyStartBtn) {
    lobbyStartBtn.addEventListener("click", async () => {
      if (!gameInitialized) await init();
      try {
        if (worker) { try { worker.postMessage({ type: "admin.claim" }); } catch (_) {} }
        requestMatchStart();
        // Countdown and state changes will arrive via server events (startingGame/game.state)
      } catch (_) {}
    });
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
      setPhase("MENU");
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
    rematchBtn.addEventListener("click", () => {
      try { if (worker) worker.postMessage({ type: "admin.end" }); } catch (_) {}
      setTimeout(() => {
        try {
          if (worker) {
            worker.postMessage({ type: "game.start", body: { playerId: yourId, playerName } });
            worker.postMessage({ type: "admin.start" });
          }
          setPhase("STARTING");
        } catch (_) {}
      }, 400);
    });
  }
  const resultsMenuBtn = document.getElementById("btn-results-menu");
  if (resultsMenuBtn) {
    resultsMenuBtn.addEventListener("click", () => {
      setPhase("MENU");
    });
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
  if (url.searchParams.get("autostart") === "1") {
    setTimeout(() => { if (!gameInitialized) init(); }, 100);
  }
} catch (_) {}
// Set initial phase based on stored name (no flicker)
(function initialPhase() {
  const saved = localStorage.getItem("yourName");
  setPhase(saved ? "MENU" : "ACCESS");
})();

// URL deep-link: ?room=CODE&name=YourName
(function applyDeepLink() {
  try {
    const url = new URL(window.location.href);
    const roomParam = url.searchParams.get("room");
    const nameParam = url.searchParams.get("name");
    if (nameParam && nameParam.trim()) {
      localStorage.setItem("yourName", nameParam.trim());
      playerName = nameParam.trim();
    }
    if (roomParam && roomParam.trim()) {
      const desired = normalizeRoomId(roomParam);
      if (desired) {
        setRoomAndBroadcast(desired, false);
        setPhase("LOBBY");
        if (!gameInitialized) { init(); }
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
    }
  });
  applyHudMode();
})();

async function init() {
  if (gameInitialized) return;
  gameInitialized = true;
  playerName = localStorage.getItem("yourName") || "Default";
  scene = new THREE.Scene();

  // Simple Fibonacci test (left from original)
  function fibonacciGenerator(maxTerm) {
    let sequence = [0, 1];
    while (sequence.length <= maxTerm) {
      sequence.push(
        sequence[sequence.length - 1] + sequence[sequence.length - 2]
      );
    }
    return sequence;
  }
  function getFibonacciNumber(term) {
    const fibonacciSequence = fibonacciGenerator(term);
    return fibonacciSequence[term - 1];
  }
  console.log(getFibonacciNumber(60));

  // Preload models/textures (asset preloading + caching)
  const assets = await preloadAssets();
  const boatModel = assets.models.boat;
  const turtleModel = assets.models.turtle;
  const boxModel = assets.models.box;
  const waternormals = assets.textures.waternormals;

  // Example: progressive preloading for non-critical assets (placeholder)
  progressivePreload([]);

  // Materials and geometries for pooled items
  const geometries = [
    new THREE.SphereGeometry(), // wildlife placeholder
    new THREE.BoxGeometry(), // trash placeholder
    new THREE.TetrahedronGeometry(0.75, 2), // power-up placeholder
  ];

  const materials = [
    new THREE.MeshPhongMaterial({ color: 0x90ee90 }), // wildlife (green)
    new THREE.MeshPhongMaterial({ color: 0xbb8e51 }), // trash (brown)
    new THREE.MeshPhongMaterial({
      color: 0xffd700,
      emissive: 0x332200,
      emissiveIntensity: 0.6,
      shininess: 100,
    }), // power-up (gold)
  ];

  // Object Pooling for wildlife
  const wildlifePool = [];
  const POOL_SIZE = 100;

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
    group.add(turtle);
    group.renderOrder = 2;
    group.userData.turtle = turtle;
    group.visible = false;
    scene.add(group);
    return group;
  }

  // Pre-allocate pool
  for (let i = 0; i < POOL_SIZE; i++) {
    wildlifePool.push(createWildlifeMesh());
  }

  function getWildlifeFromPool() {
    let group = wildlifePool.find((m) => !m.visible);
    if (!group) {
      group = createWildlifeMesh();
      wildlifePool.push(group);
    }
    // Ensure correct orientation every time it's reused
    if (group.userData && group.userData.turtle) {
      group.userData.turtle.rotation.set(-Math.PI / 2, 0, 0);
    }
    group.visible = true;
    return group;
  }

  function returnToPoolLocal(mesh) {
    mesh.visible = false;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    // Keep turtle child pitched flat for next reuse
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
    body: { wsURL, yourId, yourName: playerName, room: roomId },
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
        try {
          worker.postMessage({
            type: "player.info.joining",
            body: { id: yourId, name: playerName || localStorage.getItem("yourName") || "Default", room: roomId }
          });
        } catch (_) {}
        if (roomId) {
          try { worker.postMessage({ type: "room.join", body: { id: roomId } }); } catch (_) {}
        }
        break;
      case "disconnect":
        break;
      case "log":
        console.log(body);
        appendEventConsole("log", body);
        break;
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
        break;
      case "game.on":
        {
          // Respect manual navigation: ignore server start when user is in Menu/Access
          if (currentPhase === "MENU" || currentPhase === "ACCESS") {
            break;
          }
          const sp = body && body.startPosition ? body.startPosition : null;
          startPosition = sp;
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
          console.log("item.new received:", itemData); // debug
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
          const itemIdToDestroy = body;
          const item = items[itemIdToDestroy];
          const mesh = itemMeshes[itemIdToDestroy];
          if (item && mesh) {
            scene.remove(mesh);
            if (isMarineLife(item.type)) returnToPool(mesh);
            delete items[itemIdToDestroy];
            delete itemMeshes[itemIdToDestroy];
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
        if (currentPhase === "MENU" || currentPhase === "ACCESS") {
          break;
        }
        if (body === "WAITING") {
          setPhase("LOBBY");
        } else if (body === "STARTING") {
          setPhase("STARTING");
        } else if (body === "RUNNING") {
          setPhase("GAMEPLAY");
        } else if (body === "ENDED") {
          endGame();
          setPhase("POST_GAME");
        }
        if (typeof updateControls === "function") updateControls();
        break;
      }
      case "game.time":
        remainingTime = body;
        if (hudTimeEl) hudTimeEl.innerHTML = "Time: " + remainingTime;
        if (compactTimeEl) compactTimeEl.innerHTML = "Time: " + remainingTime;
        if (!hudTimeEl && !compactTimeEl && timerDivRef) {
          timerDivRef.innerHTML = "Time: " + remainingTime;
        }
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
          updateRoomHud();
          // Do not pull the UI back to Lobby if the user navigated to Menu/Access
          if (
            currentPhase !== "GAMEPLAY" &&
            currentPhase !== "STARTING" &&
            currentPhase !== "POST_GAME" &&
            currentPhase !== "MENU" &&
            currentPhase !== "ACCESS"
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
        }
        break;
      }
      case "room.admin": {
        const adminId = body && body.id ? String(body.id) : null;
        isAdmin = adminId === yourId;
        if (typeof updateControls === "function") updateControls();
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
        const list = document.getElementById("waiting-list");
        if (list) {
          list.innerHTML = "";
          let arr = [];
          if (Array.isArray(body)) arr = body;
          else if (body && typeof body === "object") arr = Object.values(body);
          for (const p of arr) {
            const name = typeof p === "string" ? p : (p && (p.name || p.id || JSON.stringify(p)));
            const li = document.createElement("li");
            li.textContent = name;
            list.appendChild(li);
          }
        }
        break;
      }
      case "startingGame": {
        // Do not force STARTING if user navigated back to Menu/Access
        if (currentPhase === "MENU" || currentPhase === "ACCESS") break;
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
      case "admin.start.error": {
        const st = document.getElementById("lobby-status");
        if (st) st.textContent = "Start failed: " + (body || "unknown");
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

  // Object Pooling for boats (other players)
  const boatPool = [];
  const BOAT_POOL_SIZE = 50;

  function createBoatGroup() {
    const group = new THREE.Group();
    group.visible = false;
    scene.add(group);
    return group;
  }

  // Pre-allocate boat pool
  for (let i = 0; i < BOAT_POOL_SIZE; i++) {
    boatPool.push(createBoatGroup());
  }

  function getBoatFromPool() {
    let group = boatPool.find((g) => !g.visible);
    if (!group) {
      group = createBoatGroup();
      boatPool.push(group);
    }
    group.visible = true;
    return group;
  }

  function returnBoatToPool(group) {
    if (!group) return;
    group.visible = false;
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    while (group.children.length) {
      group.remove(group.children[0]);
    }
  }

  function makePlayerMesh(playerMesh, id) {
    const group = getBoatFromPool();
    const mesh = playerMesh.clone();
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    group.add(mesh);
    const label =
      (otherPlayersInfo[id] && otherPlayersInfo[id].name)
        ? otherPlayersInfo[id].name
        : (id ? id.substring(0, 4) : "Player");
    addNameTag(group, label);
    return group;
  }

  function isPowerUp(type) {
    return String(type || "").startsWith("powerup_");
  }

  // Create a random trash or wildlife or power-up object
  function createItemMesh(itemId, itemType, position, size) {
    let itemMesh;
    if (isMarineLife(itemType)) {
      itemMesh = getWildlifeFromPool();
    } else if (isPowerUp(itemType)) {
      // Blue cone power-up
      const geometry = new THREE.ConeGeometry(0.6, 1.6, 24);
      const material = new THREE.MeshPhongMaterial({
        color: 0x3388ff,
        emissive: 0x112244,
        emissiveIntensity: 0.4,
        shininess: 80,
      });
      itemMesh = new THREE.Mesh(geometry, material);
      itemMesh.castShadow = true;
      itemMesh.receiveShadow = true;
      itemMesh.rotation.y = Math.random() * Math.PI; // subtle idle spin
      scene.add(itemMesh);
      try { disableReflectionForObject(itemMesh); } catch (_) {}
    } else {
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

/**
 * Name tags above boats
 */
function createNameSprite(text) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontSize = 48;
  canvas.width = 256;
  canvas.height = 64;
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}
function addNameTag(object3d, name) {
  const sprite = createNameSprite(name);
  sprite.name = "nameTag";
  sprite.position.set(0, 1.4, 0);
  object3d.add(sprite);
  return sprite;
}
function updateNameTag(object3d, name) {
  if (!object3d) return;
  try {
    const toRemove = [];
    for (const c of object3d.children) {
      if (c && c.name === "nameTag") toRemove.push(c);
    }
    toRemove.forEach((c) => object3d.remove(c));
  } catch (_) {}
  addNameTag(object3d, name);
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
  } catch (_) {}
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
  mesh.visible = false;
  if (mesh.position) mesh.position.set(0, 0, 0);
  // Reset wrapper group rotation
  if (mesh.rotation) mesh.rotation.set(0, 0, 0);
  // Ensure turtle child stays flat for reuse
  if (mesh.itemType === "turtle" && mesh.userData && mesh.userData.turtle) {
    mesh.userData.turtle.rotation.set(-Math.PI / 2, 0, 0);
  }
  if (mesh.scale) mesh.scale.set(1, 1, 1);
}

// FIXME models passed as array?
function startGame(gameDuration, [boat /*, turtle, box*/], sounds, waternormals) {
  console.log("StartGame: ", waternormals);

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
  renderer.toneMappingExposure = 0.55;
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
  const ambientLight = new THREE.AmbientLight(0x404040, 13);
  player.add(ambientLight);
  const hemi = new THREE.HemisphereLight(0xbcdfff, 0x244057, 0.7);
  scene.add(hemi);
  dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(dirLight);

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
  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: waternormals,
    sunDirection: new THREE.Vector3(),
    sunColor: 0xffffff,
    waterColor: 0x001e0f,
    distortionScale: 0.08,
    fog: scene.fog !== undefined,
  });
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // Skybox
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;
  skyUniforms["turbidity"].value = 10;
  skyUniforms["rayleigh"].value = 2;
  skyUniforms["mieCoefficient"].value = 0.005;
  skyUniforms["mieDirectionalG"].value = 0.8;

  const parameters = {
    elevation: 5,
    azimuth: 162,
  };
  console.log("sky", sky);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
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
    scene.environment = pmremGenerator.fromScene(sky).texture;
  }

  let lastTrace = null;
  sendYourPosition = throttle(traceRateInMillis, () => {
    if (gameOverFlag) return;
    const { x, z } = player.position;
    const { y: rotY } = player.rotation;
    const trace = {
      id: yourId,
      x: x.toFixed(10),
      z: z.toFixed(10),
      rotY: rotY.toFixed(10),
    };
    if (JSON.stringify(trace) !== JSON.stringify(lastTrace)) {
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
    powerUpState.uiDiv.innerHTML = "Power-ups: " + (active.length ? active.join(", ") : "none");
    updatePowerUpBadge();
  }

  // server handles timer updates via "game.time"

  function restart() {
    restartBtn.style.display = "none";
    for (const [, mesh] of Object.entries(itemMeshes)) {
      scene.remove(mesh);
    }
    player.position.set(0, 0, 0);
    localScore = 0;
    scoreElement.innerHTML = "Score: " + localScore;
  if (compactScoreEl) compactScoreEl.innerHTML = "Score: " + localScore;
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
  scoreElement.innerHTML = "Score: " + localScore;

  const floatAmplitude = 0.1;
  const time = performance.now() * 0.0001;


  function animateItems() {
    const tSec = performance.now() * 0.001;
    const halfW = (boundaries?.width || 100) / 2 - 1;
    const halfH = (boundaries?.height || 100) / 2 - 1;
    const dt = frameDt || 0.016;

    for (const [, mesh] of Object.entries(itemMeshes)) {
      if (mesh.outOfBounds) continue;

      if (String(mesh.itemType || "") === "turtle") {
        // Simple wandering AI within bounds
        if (!mesh.userData.ai) {
          mesh.userData.ai = {
            target: new THREE.Vector3(
              (Math.random() * 2 - 1) * halfW * 0.8,
              0,
              (Math.random() * 2 - 1) * halfH * 0.8
            ),
            speed: 0.7 + Math.random() * 0.3 // units/sec
          };
        }
        const ai = mesh.userData.ai;
        const toTarget = new THREE.Vector3().subVectors(ai.target, mesh.position);
        const dist = Math.max(0.00001, new THREE.Vector2(toTarget.x, toTarget.z).length());
        // pick new target when close
        if (dist < 1.0) {
          ai.target.set(
            (Math.random() * 2 - 1) * halfW * 0.8,
            0,
            (Math.random() * 2 - 1) * halfH * 0.8
          );
        } else {
          // Move towards target
          const step = ai.speed * dt;
          const dirXZ = new THREE.Vector2(toTarget.x, toTarget.z).normalize();
          mesh.position.x += dirXZ.x * step;
          mesh.position.z += dirXZ.y * step;

          // Clamp inside playable area
          mesh.position.x = Math.max(-halfW, Math.min(halfW, mesh.position.x));
          mesh.position.z = Math.max(-halfH, Math.min(halfH, mesh.position.z));

          // Face movement direction (yaw)
          const yaw = Math.atan2(dirXZ.x, dirXZ.y);
          mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, yaw, 0.15);
        }

        // Buoyancy (halved effect): subtle vertical + tilt
        const bh = getHeightAndNormal(mesh.position.x, mesh.position.z, tSec);
        // Smooth vertical approach (small step)
        mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, bh.height, 0.05);
        // Half-strength tilt
        applyTilt(mesh, bh.normal, 0.025, 0.12);
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
    const throttle = (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0);
    const steer = (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0);
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
    }
  }

  function checkCollisions() {
    const playerBox = new THREE.Box3().setFromObject(player);
    for (const [key, mesh] of Object.entries(itemMeshes)) {
      if (mesh.outOfBounds) continue;

      const itemMeshBox = new THREE.Box3().setFromObject(mesh);
      const collision = playerBox.intersectsBox(itemMeshBox);
      if (!collision) continue;

      // Shield: ignore marine life penalty and do not remove the turtle
      if (isMarineLife(mesh.itemType) && powerUpState.shield) {
        continue;
      }

      // For trash and power-ups, remove on collision
      const collisionData = {
        itemId: key,
        localScore,
        playerId: yourId,
        playerName: playerName,
      };

      if (String(mesh.itemType || "").startsWith("powerup_")) {
        // Apply effect locally
        applyPowerUp(mesh.itemType);
        // Notify server to remove the power-up
        worker.postMessage({
          type: "items.collision",
          body: collisionData,
        });
        if (emitters) emitters.collision.trigger(player.position);
        scene.remove(mesh);
        delete itemMeshes[key];
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

      // Trigger Oracle JSON replay around trash collection (30 frames before and after)
      try {
        if (mesh && mesh.isTrash) {
          triggerReplayMoment("trash_collect", {
            itemId: key,
            worldPos: { x: Number(mesh.position.x || 0), y: Number(mesh.position.y || 0), z: Number(mesh.position.z || 0) }
          });
        }
      } catch (_) {}

      if (isMarineLife(mesh.itemType)) returnToPool(mesh);
      else scene.remove(mesh);

      isMarineLife(mesh.itemType) ? localScore-- : localScore++;
      scoreElement.innerHTML = "Score: " + localScore;
      if (compactScoreEl) compactScoreEl.innerHTML = "Score: " + localScore;
      delete itemMeshes[key];
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
    const throttle = (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0);
    const steer = (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0);
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
    if (serverAuthEnabled && authStates) {
      Object.keys(playerMeshes).forEach((id) => {
        if (id === yourId) return;
        const s = authStates[id];
        if (!s) return;
        const m = playerMeshes[id];
        if (!m) return;
        // Smoothly approach authoritative state
        m.position.x = THREE.MathUtils.lerp(m.position.x, s.x, 0.35);
        m.position.z = THREE.MathUtils.lerp(m.position.z, s.z, 0.35);
        const delta = ((s.rotY - m.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
        m.rotation.y += delta * 0.35;
        // Trail for remote players
        addTrailPoint(id, m.position);
      });
      return;
    }
    // Fallback to legacy traces
    Object.keys(playerMeshes).forEach((id) => {
      if (otherPlayers[id]) {
        playerMeshes[id].position.x = otherPlayers[id].x;
        playerMeshes[id].position.z = otherPlayers[id].z;
        playerMeshes[id].rotation.y = otherPlayers[id].rotY;
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
    if (hudDebugEl) {
      const nowDbg = performance.now();
      const lag = serverAuthEnabled ? Math.max(0, Math.round(nowDbg - (authStatesTime || nowDbg))) : 0;
      const th = (keyboard["ArrowUp"] ? 1 : 0) + (keyboard["ArrowDown"] ? -1 : 0);
      const st = (keyboard["ArrowLeft"] ? 1 : 0) + (keyboard["ArrowRight"] ? -1 : 0);
      const sp = typeof playerSpeed === "number" ? playerSpeed.toFixed(2) : "0.00";
      const px = player ? player.position.x.toFixed(2) : "0.00";
      const pz = player ? player.position.z.toFixed(2) : "0.00";
      hudDebugEl.innerText = `Auth: ${serverAuthEnabled ? "on" : "off"} | admin: ${isAdmin ? "yes" : "no"} | lag: ${lag}ms | th:${th} st:${st} sp:${sp} pos:${px},${pz}`;
    }
    if (emitters) emitters.update(dt);
    updatePlayerPosition();
    if (gameState === "RUNNING") {
      checkCollisions();
      // Check collisions with other players' trails (Tron-like)
      checkTrailCollisionsWithPlayer();
    }
    cleanupOldTrails();
    __pushReplayFrame();
    render();
    // Throttle sky/PMREM updates for Firefox/low-end GPUs
    if (!window.__lastSunUpdate) window.__lastSunUpdate = 0;
    if ((now - window.__lastSunUpdate) > 1000) { updateSun(); window.__lastSunUpdate = now; }
    animateItems();
    if (gameState !== "STARTING" && !serverAuthEnabled && sendYourPosition) sendYourPosition();
    animateOtherPlayers(otherPlayersMeshes);
  }

  const frustum = new THREE.Frustum();
  animate();

  function render() {
    // Update water time uniform (Three.js Water shader)
    water.material.uniforms["time"].value += 1.0 / 2330.0;

    // Frustum culling
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      )
    );

    // Cull items by bounding boxes (safe for Mesh/Group) - throttled for perf
    window.__cullFrame = (window.__cullFrame | 0) + 1;
    if ((window.__cullFrame % 3) === 0) {
      Object.values(itemMeshes).forEach((m) => {
        if (!m) return;
        const box = new THREE.Box3().setFromObject(m);
        m.visible = frustum.intersectsBox(box);
      });

      Object.values(otherPlayersMeshes).forEach((g) => {
        if (!g) return;
        const box = new THREE.Box3().setFromObject(g);
        g.visible = frustum.intersectsBox(box);
      });
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

function endGame() {
  try { worker.postMessage({ type: "close" }); } catch (_) {}
  gameOverFlag = true;
  keyboard = {};

  for (const [, mesh] of Object.entries(itemMeshes)) {
    scene.remove(mesh);
  }
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
