import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Simple asset cache to avoid reloading across scenes/sessions.
 */
const cache = {
  models: new Map(),
  textures: new Map(),
};

let preloadPromise = null;

function buildColorAtlas() {
  const tile = 64;
  const width = tile * 2;
  const height = tile;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  // Tile 0: trash (brown)
  ctx.fillStyle = "#bb8e51";
  ctx.fillRect(0, 0, tile, tile);
  // Tile 1: powerup (blue)
  ctx.fillStyle = "#3388ff";
  ctx.fillRect(tile, 0, tile, tile);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const regions = {
    trash: { u: 0, v: 0, w: 0.5, h: 1 },
    powerup: { u: 0.5, v: 0, w: 0.5, h: 1 },
  };
  return { texture, regions };
}


/**
 * Load a GLTF model with caching.
 */
async function loadGLTF(url, loader) {
  if (cache.models.has(url)) return cache.models.get(url);
  const gltf = await loader.loadAsync(url);
  cache.models.set(url, gltf);
  return gltf;
}

/**
 * Load a texture with caching.
 */
async function loadTexture(url, loader) {
  if (cache.textures.has(url)) return cache.textures.get(url);
  const tex = await loader.loadAsync(url);
  // Sensible defaults for realtime
  tex.anisotropy = Math.min(8, (typeof window !== "undefined" && window?.devicePixelRatio) ? 8 : 4);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  cache.textures.set(url, tex);
  return tex;
}

/**
 * Preload all gameplay-critical assets used on the first scene.
 * Returns a stable object with cloned model roots and texture references.
 *
 * The function is idempotent and cached via preloadPromise.
 */
export async function preloadAssets() {
  if (preloadPromise) return preloadPromise;

  const manager = new THREE.LoadingManager();
  const gltfLoader = new GLTFLoader(manager);
  const textureLoader = new THREE.TextureLoader(manager);

  preloadPromise = (async () => {
    // Load models and textures in parallel, but don't hard-fail gameplay on a single fetch issue.
    const [boatRes, turtleRes, boxRes, waterRes] = await Promise.allSettled([
      loadGLTF("assets/boat.gltf", gltfLoader),
      loadGLTF("assets/turtle.gltf", gltfLoader),
      loadGLTF("assets/box.gltf", gltfLoader),
      loadTexture("assets/waternormals.jpg", textureLoader),
    ]);

    const boatGLTF = boatRes.status === "fulfilled" ? boatRes.value : null;
    const turtleGLTF = turtleRes.status === "fulfilled" ? turtleRes.value : null;
    const boxGLTF = boxRes.status === "fulfilled" ? boxRes.value : null;
    let waterNormals = waterRes.status === "fulfilled" ? waterRes.value : null;
    if (boatRes.status === "rejected") console.warn("Failed to load boat.gltf, using fallback mesh.", boatRes.reason);
    if (turtleRes.status === "rejected") console.warn("Failed to load turtle.gltf, using fallback mesh.", turtleRes.reason);
    if (boxRes.status === "rejected") console.warn("Failed to load box.gltf, using fallback mesh.", boxRes.reason);
    if (waterRes.status === "rejected") console.warn("Failed to load waternormals.jpg, using generated fallback texture.", waterRes.reason);

    // Clone reusable roots (avoid sharing same instance transforms)
    const boat =
      ((boatGLTF && (boatGLTF.scene?.children?.[0] || boatGLTF.scene)) || null)?.clone(true)
      || new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.35, 2.0),
        new THREE.MeshPhongMaterial({ color: 0x547ea5, shininess: 40 })
      );
    const turtle =
      ((turtleGLTF && (turtleGLTF.scene?.children?.[0] || turtleGLTF.scene)) || null)?.clone(true)
      || new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 16, 12),
        new THREE.MeshPhongMaterial({ color: 0x6aa84f, shininess: 20 })
      );
    if (turtle) {
      turtle.traverse((o) => {
        if (o && o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Keep original GLTF materials (no conversion)
        }
      });
    }
    // Use the full scene root to preserve the animated node hierarchy
    const box =
      ((boxGLTF && boxGLTF.scene) || null)?.clone(true)
      || new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshPhongMaterial({ color: 0xa67c52 })
      );

    // Water normals wrapping
    if (!waterNormals) {
      const data = new Uint8Array([
        127, 127, 255, 255,
        127, 127, 255, 255,
        127, 127, 255, 255,
        127, 127, 255, 255,
      ]);
      waterNormals = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
      waterNormals.needsUpdate = true;
    }
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

    const atlas = (typeof document !== "undefined") ? buildColorAtlas() : null;

    return {
      models: { boat, turtle, box },
      textures: { waternormals: waterNormals, atlas: atlas ? atlas.texture : null },
      atlasMap: atlas ? atlas.regions : null,
      // Expose raw gltf/textures if needed by callers
      raw: { boatGLTF, turtleGLTF, boxGLTF },
    };
  })().catch((e) => {
    // Reset so a temporary network failure doesn't permanently poison future init attempts.
    preloadPromise = null;
    throw e;
  });

  return preloadPromise;
}

export async function preloadNonCriticalAssets() {
  const manager = new THREE.LoadingManager();
  const textureLoader = new THREE.TextureLoader(manager);
  const tasks = [
    loadTexture("assets/menu/logo.compressed.png", textureLoader),
    loadTexture("assets/menu/logoPlusOCI.compressed.png", textureLoader),
  ];
  const results = await Promise.allSettled(tasks);
  results.forEach((res) => {
    if (res.status === "rejected") {
      console.warn("Non-critical asset failed to preload:", res.reason);
    }
  });
}

/**
 * Progressive preloading for non-critical assets (placeholder).
 * Schedules low-priority work after first render using requestIdleCallback/fallback.
 */
export function progressivePreload(tasks = []) {
  const schedule = (fn) =>
    (typeof window !== "undefined" && "requestIdleCallback" in window)
      ? window.requestIdleCallback(fn, { timeout: 2000 })
      : setTimeout(fn, 0);

  schedule(async () => {
    try {
      for (const task of tasks) {
        await task();
      }
    } catch (e) {
      // best-effort background loading; log and continue
      // eslint-disable-next-line no-console
      console.warn("Progressive preload task failed:", e);
    }
  });
}

/**
 * Accessors in case you want to check if something is already cached.
 */
export function getCachedModel(url) {
  return cache.models.get(url);
}
export function getCachedTexture(url) {
  return cache.textures.get(url);
}

export function getAssetCacheMetrics() {
  return {
    models: cache.models.size,
    textures: cache.textures.size,
    preloadStarted: preloadPromise !== null,
  };
}

// Back-compat alias (older caller)
export function getAssetCacheStats() {
  return getAssetCacheMetrics();
}
