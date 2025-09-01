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
    // Load models and textures in parallel
    const [boatGLTF, turtleGLTF, boxGLTF, waterNormals] = await Promise.all([
      loadGLTF("assets/boat.gltf", gltfLoader),
      loadGLTF("assets/turtle.gltf", gltfLoader),
      loadGLTF("assets/box.gltf", gltfLoader),
      loadTexture("assets/waternormals.jpg", textureLoader),
    ]);

    // Clone reusable roots (avoid sharing same instance transforms)
    const boat = (boatGLTF.scene?.children?.[0] || boatGLTF.scene)?.clone(true);
    const turtle = (turtleGLTF.scene?.children?.[0] || turtleGLTF.scene)?.clone(true);
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
    const box = (boxGLTF.scene)?.clone(true);

    // Water normals wrapping
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

    return {
      models: { boat, turtle, box },
      textures: { waternormals: waterNormals },
      // Expose raw gltf/textures if needed by callers
      raw: { boatGLTF, turtleGLTF, boxGLTF },
    };
  })();

  return preloadPromise;
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
