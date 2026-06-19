import * as THREE from "three";

const DEFAULTS = Object.freeze({
  desktopCount: 20,
  mobileCount: 12,
  desktopLife: 0.82,
  mobileLife: 0.62,
  minStrength: 0.08,
  color: 0xe6fbff,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeRipple(scene, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material.clone());
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 24;
  mesh.userData.age = 0;
  mesh.userData.life = 1;
  mesh.userData.strength = 0;
  mesh.userData.side = 1;
  scene.add(mesh);
  return mesh;
}

export function createWakeRippleEffect(scene, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const mobile = !!opts.mobile;
  const count = mobile ? opts.mobileCount : opts.desktopCount;
  const life = mobile ? opts.mobileLife : opts.desktopLife;
  const geometry = new THREE.RingGeometry(0.44, 0.53, 36, 1, -Math.PI * 0.62, Math.PI * 1.24);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: opts.color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const pool = [];
  for (let i = 0; i < count; i += 1) {
    pool.push(makeRipple(scene, geometry, material));
  }
  let cursor = 0;
  let visible = 0;

  function emitOne(position, yaw, strength, side) {
    const ripple = pool[cursor];
    cursor = (cursor + 1) % pool.length;
    const sideOffset = side * (0.2 + strength * 0.08);
    const backOffset = -0.34 - strength * 0.18;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    ripple.position.set(
      position.x + cos * sideOffset + sin * backOffset,
      position.y + 0.012,
      position.z - sin * sideOffset + cos * backOffset
    );
    ripple.rotation.y = yaw + side * (0.48 + strength * 0.18);
    ripple.scale.set(0.34 + strength * 0.16, 1, 0.1 + strength * 0.06);
    ripple.material.opacity = 0.18 + strength * 0.1;
    ripple.visible = true;
    ripple.userData.age = 0;
    ripple.userData.life = life;
    ripple.userData.strength = strength;
    ripple.userData.side = side;
  }

  function emit(position, yaw = 0, strength = 0) {
    if (!position || !pool.length) return;
    const s = clamp(Number(strength) || 0, 0, 1);
    if (s < opts.minStrength) return;
    emitOne(position, yaw, s, -1);
    emitOne(position, yaw, s, 1);
  }

  function update(dt) {
    const step = clamp(Number(dt) || 0.016, 0, 0.05);
    visible = 0;
    for (const ripple of pool) {
      if (!ripple.visible) continue;
      ripple.userData.age += step;
      const t = clamp(ripple.userData.age / ripple.userData.life, 0, 1);
      if (t >= 1) {
        ripple.visible = false;
        ripple.material.opacity = 0;
        continue;
      }
      const strength = ripple.userData.strength || 0;
      const alpha = Math.pow(1 - t, 1.55);
      const grow = 1 + t * (0.9 + strength * 0.45);
      ripple.scale.x = (0.34 + strength * 0.16) * grow;
      ripple.scale.z = (0.1 + strength * 0.06) * (1 + t * 0.85);
      ripple.material.opacity = alpha * (0.2 + strength * 0.1);
      visible += 1;
    }
  }

  function dispose() {
    for (const ripple of pool) {
      scene.remove(ripple);
      ripple.material.dispose();
    }
    geometry.dispose();
    material.dispose();
  }

  function stats() {
    return { visible, capacity: pool.length };
  }

  return { emit, update, dispose, stats };
}
