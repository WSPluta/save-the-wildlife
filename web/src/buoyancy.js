import * as THREE from "three";

/**
 * Lightweight CPU-side buoyancy using a sum of Gerstner-like waves.
 * - getHeightAndNormal(x, z, time): returns { height, normal }
 * - applyTilt(obj, normal, tiltStrength=0.15, lerp=0.2): subtly tilts obj to align with water normal
 *
 * This is designed to be fast enough for dozens of objects per frame and
 * visually consistent with the animated Water time uniform.
 */

// Wave configuration (units roughly match scene scale)
const WAVES = [
  // dir(x,z), amplitude, wavelength, speed, steepness
  { dir: new THREE.Vector2(1.0, 0.4).normalize(), A: 0.02, L: 14.0, S: 0.5, Q: 0.8 },
  { dir: new THREE.Vector2(-0.8, 1.0).normalize(), A: 0.015, L: 8.0, S: 0.8, Q: 0.7 },
  { dir: new THREE.Vector2(0.2, -1.0).normalize(), A: 0.01, L: 4.5, S: 1.1, Q: 0.6 },
];

const TWO_PI = Math.PI * 2.0;

export function getHeightAndNormalInto(x, z, time = 0, target = {}) {
  let height = 0.0;

  // Partial derivatives for normal (d(height)/dx, d(height)/dz)
  let dHdX = 0.0;
  let dHdZ = 0.0;

  for (let i = 0; i < WAVES.length; i++) {
    const { dir, A, L, S } = WAVES[i];
    const k = TWO_PI / L; // wave number
    const w = Math.sqrt(9.81 * k) * S; // angular frequency (scaled)
    const phase = k * (dir.x * x + dir.y * z) - w * time;

    const s = Math.sin(phase);
    const c = Math.cos(phase);

    height += A * s;

    // d/dx and d/dz of height = A * sin(phase)
    // where phase = k * (dir.x * x + dir.y * z) - w*t
    dHdX += A * c * k * dir.x;
    dHdZ += A * c * k * dir.y;
  }

  // Normal from gradient: n = normalize( -dHdX, 1, -dHdZ )
  const normal = target.normal || new THREE.Vector3();
  normal.set(-dHdX, 1.0, -dHdZ).normalize();

  target.height = height;
  target.normal = normal;
  return target;
}

export function getHeightAndNormal(x, z, time = 0) {
  const { height, normal } = getHeightAndNormalInto(x, z, time, {
    normal: new THREE.Vector3(),
  });
  return { height, normal };
}

/**
 * Subtly tilts an object to align its up-axis with the water normal,
 * preserving heading (rotation.y) handled by caller.
 */
export function applyTilt(obj, normal, tiltStrength = 0.15, lerp = 0.2) {
  if (!obj || !normal) return;
  // Small roll/pitch from normal
  const targetPitchX = -normal.z * tiltStrength; // rotate around X when normal leans towards/away (Z)
  const targetRollZ = normal.x * tiltStrength;   // rotate around Z when normal leans left/right (X)

  obj.rotation.x = THREE.MathUtils.lerp(obj.rotation.x, targetPitchX, lerp);
  obj.rotation.z = THREE.MathUtils.lerp(obj.rotation.z, targetRollZ, lerp);
}
