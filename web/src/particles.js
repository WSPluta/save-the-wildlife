import * as THREE from "three";

/**
 * Lightweight GPU-friendly particle emitters with simple pooling.
 * - Uses THREE.Points with a single BufferGeometry per emitter.
 * - No per-object creation during runtime (preallocated arrays).
 * - update(dt) mutates attribute buffers in-place.
 *
 * Emitters:
 * - engine: continuous small smoke/wake dots behind the boat (max ~50)
 * - splash: short bursts (100) for water splashes
 * - collision: bigger burst (200) on collisions and freeze hits
 *
 * Mobile optimization: pass a scale factor (0.5 typical) to reduce counts.
 */

class PointsEmitter {
  constructor(scene, {
    maxCount = 100,
    color = 0xffffff,
    size = 0.06,
    lifetime = 1.0,
    sceneAdd = true,
    blending = THREE.AdditiveBlending
  }) {
    this.maxCount = maxCount;
    this.lifetime = lifetime;

    // Number of alive particles currently rendered
    this.count = 0;

    this.positions = new Float32Array(maxCount * 3);
    this.velocities = new Float32Array(maxCount * 3);
    this.ages = new Float32Array(maxCount);
    this.alive = new Uint8Array(maxCount); // 0 or 1
    this.freeList = Array.from({ length: maxCount }, (_, i) => i);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geom.setAttribute("aAge", new THREE.BufferAttribute(this.ages, 1));
    // Start with no particles rendered; expand as we emit
    geom.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      depthWrite: false,
      blending
    });

    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;

    if (sceneAdd) scene.add(this.points);
  }

  dispose(scene) {
    if (this.points) {
      if (scene) scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
  }

  get aliveCount() {
    let c = 0;
    for (let i = 0; i < this.maxCount; i++) if (this.alive[i]) c++;
    return c;
  }

  emit(pos, vel, lifeScale = 1.0) {
    if (this.freeList.length === 0) return;
    const idx = this.freeList.pop();

    this.positions[idx * 3 + 0] = pos.x;
    this.positions[idx * 3 + 1] = pos.y;
    this.positions[idx * 3 + 2] = pos.z;

    this.velocities[idx * 3 + 0] = vel.x;
    this.velocities[idx * 3 + 1] = vel.y;
    this.velocities[idx * 3 + 2] = vel.z;

    this.ages[idx] = 0.0001; // alive, minimal age
    this.alive[idx] = 1;
    this.count++;
    // Expand draw range to include the newly alive particle
    if (this.points && this.points.geometry) {
      this.points.geometry.setDrawRange(0, this.count);
    }

    // Slightly vary lifetime via lifeScale factor (kept implicit)
    // This emitter uses a global lifetime; could be adjusted per particle if desired.
  }

  update(dt) {
    if (!this.points) return;
    const pos = this.positions;
    const vel = this.velocities;
    const age = this.ages;
    const alive = this.alive;

    let anyChanged = false;

    for (let i = 0; i < this.maxCount; i++) {
      if (!alive[i]) continue;

      age[i] += dt;
      if (age[i] >= this.lifetime) {
        alive[i] = 0;
        this.freeList.push(i);
        this.count = Math.max(0, this.count - 1);
        // move far away to avoid accidental render if any leftover drawRange (safety)
        pos[i * 3 + 0] = 1e6;
        pos[i * 3 + 1] = 1e6;
        pos[i * 3 + 2] = 1e6;
        anyChanged = true;
        continue;
      }

      // Integrate simple motion
      pos[i * 3 + 0] += vel[i * 3 + 0] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;

      // Simple upward drift and mild damping
      vel[i * 3 + 1] += 0.1 * dt;
      vel[i * 3 + 0] *= (1.0 - 0.9 * dt);
      vel[i * 3 + 2] *= (1.0 - 0.9 * dt);

      anyChanged = true;
    }

    if (anyChanged) {
      this.points.geometry.attributes.position.needsUpdate = true;
      // Only render the currently alive particles
      this.points.geometry.setDrawRange(0, this.count);
    }
  }
}

export function createEmitters(scene, scale = 1.0) {
  // Clamp scale
  const s = Math.max(0.25, Math.min(1.0, scale));

  const engine = new PointsEmitter(scene, {
    maxCount: Math.floor(20 * s),
    color: 0x88c8ff,
    size: 0.008,
    lifetime: 0.5,
    blending: THREE.AdditiveBlending
  });

  const splash = new PointsEmitter(scene, {
    maxCount: Math.floor(30 * s),
    color: 0x66aaff,
    size: 0.01,
    lifetime: 0.3,
    blending: THREE.AdditiveBlending
  });

  const collision = new PointsEmitter(scene, {
    maxCount: Math.floor(80 * s),
    color: 0xffcc66,
    size: 0.018,
    lifetime: 0.5,
    blending: THREE.AdditiveBlending
  });

  function update(dt) {
    engine.update(dt);
    splash.update(dt);
    collision.update(dt);
  }

  // High-level helpers

  function emitEngineAt(position, direction, intensity = 3) {
    // Emit a few particles per frame behind the boat (reduced)
    const backDir = new THREE.Vector3().copy(direction).multiplyScalar(-1);
    const baseVel = backDir.multiplyScalar(0.7);
    const n = Math.min(3, Math.max(1, Math.floor(intensity))); // 1..3
    for (let i = 0; i < n; i++) {
      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.3
      );
      const vel = new THREE.Vector3().copy(baseVel).add(jitter);
      const p = new THREE.Vector3(
        position.x + (Math.random() - 0.5) * 0.2,
        position.y + 0.05,
        position.z + (Math.random() - 0.5) * 0.2
      );
      engine.emit(p, vel);
    }
  }

  function triggerSplash(position, amount = 2) {
    for (let i = 0; i < amount; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        Math.random() * 0.8 + 0.15,
        (Math.random() - 0.5) * 0.6
      );
      const p = new THREE.Vector3(position.x, position.y, position.z);
      splash.emit(p, vel);
    }
  }

  function triggerCollision(position, amount = 12) {
    for (let i = 0; i < amount; i++) {
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2.0,
        Math.random() * 2.0,
        (Math.random() - 0.5) * 2.0
      );
      const p = new THREE.Vector3(
        position.x,
        position.y + 0.2,
        position.z
      );
      collision.emit(p, vel);
    }
  }

  function dispose() {
    engine.dispose(scene);
    splash.dispose(scene);
    collision.dispose(scene);
  }

  return {
    engine: { emitAt: emitEngineAt },
    splash: { trigger: triggerSplash },
    collision: { trigger: triggerCollision },
    update,
    dispose
  };
}
