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

let serverAuthEnabled = false;
let serverPhysics = null;
let inputSeq = 0;
let authStates = null;
let authStatesTime = 0;
let startPosition = null;

// Tron-like trail settings and state
let trails = {};
const TRAIL_POINT_DISTANCE = 0.5;
const MAX_TRAIL_POINTS = 11;
const TRAIL_COLLISION_RADIUS = 0.6;
const TRAIL_TTL_MS = 5000; // remove trail if no new points for 5s
let freezeUntilMs = 0;
let freezeDiv = null;

// Power-up runtime state
const powerUpState = {
  speedMultiplier: 1,
  shield: false,
  timers: {},
  uiDiv: null,
};

lobby.getLeaderBoard();

const createGameButton = document.getElementById("create-game-button");
createGameButton.addEventListener("click", init);

async function init() {
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

  // Audio
  const audioLoader = new THREE.AudioLoader();
  sounds = await audioLoader.loadAsync("assets/mixkit-motorboat-on-the-sea-1183.m4v");

  // Comms
  const hostname = window.location.hostname;
  const isDevelopment = hostname === "localhost";
  const wsURL = isDevelopment ? "ws://localhost:3000" : "ws://";

  worker = new Worker(new URL("./commsWorker.js", import.meta.url));
  worker.postMessage({
    type: "init",
    body: { wsURL, yourId, yourName: playerName },
  });

  // Admin controls
  const adminStartBtn = document.getElementById("admin-start");
  const adminEndBtn = document.getElementById("admin-end");
  if (adminStartBtn) {
    adminStartBtn.onclick = () => {
      worker.postMessage({
        type: "game.start",
        body: { playerId: yourId, playerName },
      });
      worker.postMessage({ type: "admin.start" });
    };
  }
  if (adminEndBtn) {
    adminEndBtn.onclick = () => {
      worker.postMessage({ type: "admin.end" });
    };
  }

  showWaiting();

  worker.onmessage = ({ data }) => {
    const { type, body, error } = data;
    if (error) {
      Object.keys(otherPlayersMeshes).forEach((id) =>
        scene.remove(otherPlayersMeshes[id])
      );
      otherPlayers = {};
      otherPlayersMeshes = {};
    }
    switch (type) {
      case "connect":
        break;
      case "disconnect":
        break;
      case "log":
        console.log(body);
        break;
      case "server.info":
        serverVersion = body.version;
        gameDuration = body.gameDuration;
        boundaries.width = body.worldSizeX;
        boundaries.height = body.worldSizeZ;
        serverAuthEnabled = !!body.serverAuthEnabled;
        serverPhysics = body.physics || null;
        break;
      case "game.on":
        {
          const sp = body && body.startPosition ? body.startPosition : null;
          startPosition = sp;
          worker.postMessage({
            type: "game.start",
            body: { playerId: yourId, playerName },
          });
          startGame(
            gameDuration,
            [boatModel, turtleModel, boxModel],
            sounds,
            waternormals
          );
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
        break;
      case "player.info.joined":
        {
          const { id: joinedId } = body;
          if (joinedId !== yourId) {
            otherPlayersMeshes[joinedId] = makePlayerMesh(boatModel, joinedId);
          }
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
        }
        break;
      case "player.info.all":
        otherPlayersInfo = body || {};
        break;
      case "game.state":
        gameState = body;
        if (body === "WAITING") {
          // Hide any overlays while waiting
          hideMessages();
        } else if (body === "STARTING") {
          showStarting();
        } else if (body === "RUNNING") {
          hideMessages();
        } else if (body === "ENDED") {
          endGame();
        }
        break;
      case "game.time":
        remainingTime = body;
        if (timerDivRef) timerDivRef.innerHTML = "Time: " + remainingTime;
        break;
      case "player.state":
        if (body && body.states) {
          authStates = body.states;
          authStatesTime = body.t || performance.now();
        }
        break;
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
    } else {
      const geometry = geometries[1];
      const material = materials[1];
      itemMesh = new THREE.Mesh(geometry, material);
      scene.add(itemMesh);
    }
    itemMesh.position.set(position.x, position.y, position.z);

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

    itemMesh.scale.set(size, size, size);
    itemMesh.itemId = itemId;
    itemMesh.itemType = itemType;
    itemMesh.isTrash = !isMarineLife(itemType) && !isPowerUp(itemType);
    itemMesh.outOfBounds = false;

    // bounds check
    const objectBoundaries = new THREE.Box3().setFromObject(itemMesh);
    if (
      objectBoundaries.min.x > boundaries.width / 2 ||
      objectBoundaries.max.x < -boundaries.width / 2 ||
      objectBoundaries.min.z > boundaries.height / 2 ||
      objectBoundaries.max.z < -boundaries.height / 2
    ) {
      itemMesh.outOfBounds = true;
      if (isMarineLife(itemType)) returnToPoolLocal(itemMesh);
      else scene.remove(itemMesh);
      return;
    }

    itemMeshes[itemId] = itemMesh;
    return itemMesh;
  }

  const overlay = document.getElementById("overlay");
  if (overlay) overlay.remove();
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
  sprite.position.set(0, 1.4, 0);
  object3d.add(sprite);
  return sprite;
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
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

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
  // No local name tag (only show names above other boats)

  // lights
  const ambientLight = new THREE.AmbientLight(0x404040, 13);
  player.add(ambientLight);
  const hemi = new THREE.HemisphereLight(0xbcdfff, 0x244057, 0.7);
  scene.add(hemi);
  dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(dirLight);

  // audio
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const sound = new THREE.Audio(listener);
  sound.setBuffer(sounds);
  sound.setVolume(0.09);
  sound.play();
  sound.setLoop(true);

  window.addEventListener("resize", function () {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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

  // Timer UI (server authoritative via game.time)
  remainingTime = gameDuration;
  const timerDiv = document.createElement("div");
  timerDiv.style.position = "absolute";
  timerDiv.style.top = "45px";
  timerDiv.style.left = "10px";
  timerDiv.style.color = "white";
  timerDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  timerDiv.innerHTML = "Time: " + remainingTime;
  document.body.appendChild(timerDiv);
  timerDivRef = timerDiv;

  const versionsDiv = document.createElement("div");
  versionsDiv.style.position = "absolute";
  versionsDiv.style.bottom = "10px";
  versionsDiv.style.right = "10px";
  versionsDiv.style.color = "white";
  versionsDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  versionsDiv.innerHTML = "Server: " + serverVersion;
  document.body.appendChild(versionsDiv);

  speedElement = document.createElement("div");
  speedElement.style.position = "absolute";
  speedElement.style.top = "65px";
  speedElement.style.left = "10px";
  speedElement.style.color = "white";
  speedElement.style.fontSize = "13px";
  speedElement.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  speedElement.innerHTML = "Speed: ";
  document.body.appendChild(speedElement);

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

  function updatePowerUpUI() {
    const active = [];
    if (powerUpState.speedMultiplier > 1) active.push("Speed x" + powerUpState.speedMultiplier);
    if (powerUpState.shield) active.push("Shield");
    powerUpState.uiDiv.innerHTML = "Power-ups: " + (active.length ? active.join(", ") : "none");
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
    remainingTime = remainingTime;
    if (timerDivRef) timerDivRef.innerHTML = "Time: " + remainingTime;
  }

  const scoreElement = document.createElement("div");
  scoreElement.style.position = "absolute";
  scoreElement.style.top = "10px";
  scoreElement.style.left = "10px";
  scoreElement.style.color = "white";
  scoreElement.style.fontSize = "24px";
  scoreElement.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  scoreElement.innerHTML = "Score: " + localScore;
  document.body.appendChild(scoreElement);

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
        // Simple idle bobbing for non-turtles
        const t = tSec;
        const sinValue = Math.sin(t * 2 + mesh.position.x * 0.5 + mesh.position.z * 0.3);
        mesh.position.y = sinValue * floatAmplitude;
      }

      // Keep power-up idle spin
      if (String(mesh.itemType || "").startsWith("powerup_")) {
        mesh.rotation.y += 0.01;
      }
    }
  }

  document.addEventListener("keydown", function (event) {
    keyboard[event.code] = true;
  });
  document.addEventListener("keyup", function (event) {
    keyboard[event.code] = false;
  });

  let playerSpeed = 0;

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

      if (isMarineLife(mesh.itemType)) returnToPool(mesh);
      else scene.remove(mesh);

      isMarineLife(mesh.itemType) ? localScore-- : localScore++;
      scoreElement.innerHTML = "Score: " + localScore;
      delete itemMeshes[key];
    }
  }


  function updatePlayerPosition() {
    if (!player || !water || gameOverFlag) return;

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
      return;
    } else if (freezeDiv) {
      freezeDiv.innerHTML = "";
    }

    const ACCELERATION_BASE = 1;
    const BRAKE = 0.0005;
    const MAX_SPEED_BASE = 0.05;
    const FRICTION = 0.003;
    const TURN_SPEED = Math.PI / 360;
    const DRIFT_FACTOR = 0.02;

    const ACCELERATION = ACCELERATION_BASE * powerUpState.speedMultiplier;
    const MAX_SPEED = MAX_SPEED_BASE * powerUpState.speedMultiplier;

    const dt = frameDt || 0.016;
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

    if (!serverAuthEnabled) {
      if (throttle > 0) {
        playerSpeed += ACCELERATION * throttle * dt;
      } else if (throttle < 0) {
        playerSpeed -= BRAKE * (-throttle) * dt;
      }
    }

    if (!serverAuthEnabled && steer !== 0) {
      player.rotation.y += TURN_SPEED * steer * dt;
      if (keyboard["ArrowUp"]) {
        playerSpeed *= Math.exp(-FRICTION * dt);
      }
    }

    if (!serverAuthEnabled && !keyboard["ArrowUp"] && !keyboard["ArrowDown"]) {
      playerSpeed *= Math.exp(-FRICTION * dt);
    }


    if (!serverAuthEnabled) {
      playerSpeed = Math.max(Math.min(playerSpeed, MAX_SPEED), -MAX_SPEED);
      speedElement.innerHTML = `Speed: ${(playerSpeed * 100).toFixed(2)}`;
    } else {
      const s = authStates && authStates[yourId];
      const shown = s && typeof s.speed === "number" ? Math.abs(s.speed) : 0;
      speedElement.innerHTML = `Speed: ${(shown * 100).toFixed(2)}`;
    }

    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(
      player.quaternion
    );

    const CAMERA_DISTANCE = 2;
    const CAMERA_HEIGHT = 0.5;
    const SPRING_STRENGTH = 0.1;

    const lastPosition = player.position.clone();
    if (!serverAuthEnabled) {
      player.position.addScaledVector(direction, playerSpeed * dt);
    }

    const playerBoundingBox = new THREE.Box3().setFromObject(player);
    if (!playerBoundingBox.intersectsBox(navmeshBoundingBox)) {
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
    if (serverAuthEnabled && authStates && authStates[yourId]) {
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
      emitters.engine.emitAt(player.position, dir, 1 + Math.abs(playerSpeed) * 150);
      // Water splash when steering at speed
      if (Math.abs(playerSpeed) > 0.01 && (keyboard["ArrowLeft"] || keyboard["ArrowRight"])) {
        emitters.splash.trigger(player.position, 6);
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
    if (emitters) emitters.update(dt);
    updatePlayerPosition();
    checkCollisions();
    // Check collisions with other players' trails (Tron-like)
    checkTrailCollisionsWithPlayer();
    cleanupOldTrails();
    render();
    updateSun();
    animateItems();
    if (!serverAuthEnabled && sendYourPosition) sendYourPosition();
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

    // Cull items by bounding boxes (safe for Mesh/Group)
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
  worker.postMessage({ type: "close" });
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

  const scoreOverlay = document.createElement("div");
  scoreOverlay.id = "score-overlay";
  scoreOverlay.innerHTML = "Game Over";
  scoreOverlay.innerHTML += "<br>Name: " + playerName;
  scoreOverlay.innerHTML += "<br>Score: " + localScore;
  document.body.appendChild(scoreOverlay);

  const restartBtn = document.createElement("button");
  restartBtn.innerHTML = "Restart";
  restartBtn.style.position = "absolute";
  restartBtn.style.top = "100px";
  restartBtn.style.left = "10px";
  restartBtn.addEventListener("click", function () {
    window.location.reload();
  });
  document.body.appendChild(restartBtn);

  clearTimeout(timerId);
}

// UI helpers
function showWaiting() {
  // Hide/remove any existing waiting overlay instead of showing it
  const waitingDiv = document.getElementById("waiting-div");
  if (waitingDiv) waitingDiv.remove();
}

function showStarting() {
  // Remove waiting overlay if present
  const waitingDiv = document.getElementById("waiting-div");
  if (waitingDiv) waitingDiv.remove();

  let startingDiv = document.getElementById("starting-div");
  if (!startingDiv) {
    startingDiv = document.createElement("div");
    startingDiv.id = "starting-div";
    startingDiv.style.position = "absolute";
    startingDiv.style.top = "50%";
    startingDiv.style.left = "50%";
    startingDiv.style.transform = "translate(-50%, -50%)";
    startingDiv.style.color = "white";
    startingDiv.style.fontSize = "24px";
    startingDiv.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    document.body.appendChild(startingDiv);
  }

  // Start/Restart 10-second countdown
  startingTargetTs = Date.now() + 10000;
  if (startingIntervalId) {
    clearInterval(startingIntervalId);
    startingIntervalId = null;
  }
  const update = () => {
    const msLeft = Math.max(0, startingTargetTs - Date.now());
    const secs = Math.max(0, Math.ceil(msLeft / 1000));
    startingDiv.innerHTML = "Game starting in " + secs + "…";
  };
  update();
  startingIntervalId = setInterval(update, 100);
}

function hideMessages() {
  if (startingIntervalId) {
    clearInterval(startingIntervalId);
    startingIntervalId = null;
  }
  const waitingDiv = document.getElementById("waiting-div");
  if (waitingDiv) waitingDiv.remove();
  const startingDiv = document.getElementById("starting-div");
  if (startingDiv) startingDiv.remove();
}
