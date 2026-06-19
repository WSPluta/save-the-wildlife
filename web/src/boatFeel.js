import * as THREE from "three";
import { getHeightAndNormalInto } from "./buoyancy";

export const BOAT_FEEL_DEFAULTS = Object.freeze({
  waterSurfaceY: 0,
  waterlineOffset: -0.066,
  minVisualY: -0.074,
  maxVisualY: -0.056,
  surfaceRippleY: 0.003,
  sampleForward: 0.82,
  sampleSide: 0.34,
  verticalWaveStrength: 0.22,
  speedSettleDepth: 0.006,
  maxPitch: 0.075,
  maxRoll: 0.14,
  wavePitchStrength: 1.45,
  waveRollStrength: 1.15,
  bankStrength: 0.105,
  accelPitchStrength: 0.0045,
  smoothing: 7.25,
  ySmoothing: 5.5,
  wakeSmoothing: 9.0,
  maxDt: 0.05,
  wakeMinSpeed: 0.35,
  wakeIntervalDesktop: 0.14,
  wakeIntervalMobile: 0.22,
  wakeMaxBurstsDesktop: 8,
  wakeMaxBurstsMobile: 4,
});

const SAMPLE_KEYS = ["center", "bow", "stern", "port", "starboard"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothingFactor(rate, dt) {
  return 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
}

function makeSample() {
  return {
    x: 0,
    z: 0,
    height: 0,
    normal: new THREE.Vector3(),
  };
}

export function createBoatFeelState(options = {}) {
  const mergedOptions = { ...BOAT_FEEL_DEFAULTS, ...options };
  const initialY = clamp(
    mergedOptions.waterlineOffset,
    mergedOptions.minVisualY,
    mergedOptions.maxVisualY
  );
  const state = {
    y: initialY,
    pitch: 0,
    roll: 0,
    wake: 0,
    prevSpeed: 0,
    prevX: null,
    prevZ: null,
    wakeCooldown: 0,
    pivot: null,
    samples: {},
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    stern: new THREE.Vector3(),
    debug: {
      y: Number(initialY.toFixed(3)),
      surfaceY: Number(mergedOptions.waterSurfaceY.toFixed(3)),
      pitch: 0,
      roll: 0,
      wake: 0,
    },
    options: mergedOptions,
  };
  for (const key of SAMPLE_KEYS) {
    state.samples[key] = makeSample();
  }
  return state;
}

export function installBoatFeelPivot(root, visualChildren = null) {
  if (!root || !root.isObject3D) return null;
  if (root.userData && root.userData.boatFeelPivot) {
    return root.userData.boatFeelPivot;
  }

  const children = Array.isArray(visualChildren)
    ? visualChildren.filter((child) => child && child.parent === root)
    : root.children.slice();
  if (!children.length) return null;

  const pivot = new THREE.Group();
  pivot.name = "boatFeelPivot";
  pivot.userData.visualOnly = true;

  root.add(pivot);
  for (const child of children) {
    pivot.attach(child);
  }
  root.userData.boatFeelPivot = pivot;
  return pivot;
}

function sampleWave(target, x, z, time) {
  getHeightAndNormalInto(x, z, time, target);
  target.x = x;
  target.z = z;
  return target;
}

function sampleBoatWater(root, state, time) {
  const opts = state.options;
  const yaw = root.rotation?.y || 0;
  const px = root.position?.x || 0;
  const pz = root.position?.z || 0;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const fore = opts.sampleForward;
  const side = opts.sampleSide;

  state.forward.set(fx, 0, fz);
  state.right.set(rx, 0, rz);

  sampleWave(state.samples.center, px, pz, time);
  sampleWave(state.samples.bow, px + fx * fore, pz + fz * fore, time);
  sampleWave(state.samples.stern, px - fx * fore, pz - fz * fore, time);
  sampleWave(state.samples.port, px - rx * side, pz - rz * side, time);
  sampleWave(state.samples.starboard, px + rx * side, pz + rz * side, time);
}

function estimateSpeed(root, state, dt, providedSpeed) {
  if (Number.isFinite(providedSpeed)) {
    return providedSpeed;
  }
  const x = root.position?.x || 0;
  const z = root.position?.z || 0;
  if (state.prevX == null || state.prevZ == null || dt <= 0) {
    state.prevX = x;
    state.prevZ = z;
    return 0;
  }
  const dx = x - state.prevX;
  const dz = z - state.prevZ;
  state.prevX = x;
  state.prevZ = z;
  return Math.hypot(dx, dz) / dt;
}

function maybeEmitWake(root, state, dt, isMobile, speed, maxSpeed, wakeRipples) {
  const opts = state.options;
  const speedAbs = Math.abs(speed || 0);
  const targetWake = speedAbs < opts.wakeMinSpeed
    ? 0
    : clamp(speedAbs / Math.max(1, maxSpeed || 3), 0, 1);
  const wakeLerp = smoothingFactor(opts.wakeSmoothing, dt);
  state.wake += (targetWake - state.wake) * wakeLerp;
  state.wakeCooldown = Math.max(0, state.wakeCooldown - dt);

  if (state.wake <= 0.08 || state.wakeCooldown > 0) return;
  const interval = isMobile ? opts.wakeIntervalMobile : opts.wakeIntervalDesktop;
  state.stern.copy(state.forward).multiplyScalar(-0.72).add(root.position);
  state.stern.y = root.position.y + opts.waterSurfaceY + opts.surfaceRippleY;
  if (wakeRipples && typeof wakeRipples.emit === "function") {
    wakeRipples.emit(state.stern, root.rotation?.y || 0, state.wake);
  }
  state.wakeCooldown = interval;
}

export function updateBoatFeel(root, state, input = {}) {
  if (!root || !state) return null;
  const pivot = state.pivot || root.userData?.boatFeelPivot || installBoatFeelPivot(root);
  if (!pivot) return null;
  state.pivot = pivot;

  const opts = state.options;
  const dt = clamp(Number(input.dt) || 0.016, 0.001, opts.maxDt);
  const time = Number.isFinite(input.time) ? input.time : 0;
  const speed = estimateSpeed(root, state, dt, input.speed);
  const maxSpeed = Math.max(0.001, Number(input.maxSpeed) || 3);
  const speedRatio = clamp(Math.abs(speed) / maxSpeed, 0, 1);
  const steer = clamp(Number(input.steer) || 0, -1, 1);

  sampleBoatWater(root, state, time);

  const samples = state.samples;
  const avgHeight =
    (samples.center.height +
      samples.bow.height +
      samples.stern.height +
      samples.port.height +
      samples.starboard.height) / 5;
  const acceleration = clamp((speed - state.prevSpeed) / dt, -12, 12);
  state.prevSpeed = speed;

  const downwardWaveSettle = Math.abs(avgHeight) * opts.verticalWaveStrength;
  const speedSettle = speedRatio * opts.speedSettleDepth;
  const targetY = clamp(
    opts.waterSurfaceY + opts.waterlineOffset - downwardWaveSettle - speedSettle,
    opts.minVisualY,
    opts.maxVisualY
  );
  const targetPitch = clamp(
    ((samples.stern.height - samples.bow.height) / Math.max(0.001, opts.sampleForward * 2)) *
      opts.wavePitchStrength -
      acceleration * opts.accelPitchStrength,
    -opts.maxPitch,
    opts.maxPitch
  );
  const targetRoll = clamp(
    ((samples.starboard.height - samples.port.height) / Math.max(0.001, opts.sampleSide * 2)) *
      opts.waveRollStrength -
      steer * speedRatio * opts.bankStrength,
    -opts.maxRoll,
    opts.maxRoll
  );

  const yLerp = smoothingFactor(opts.ySmoothing, dt);
  const rotLerp = smoothingFactor(opts.smoothing, dt);
  state.y += (targetY - state.y) * yLerp;
  state.pitch += (targetPitch - state.pitch) * rotLerp;
  state.roll += (targetRoll - state.roll) * rotLerp;

  pivot.position.y = state.y;
  pivot.rotation.x = state.pitch;
  pivot.rotation.z = state.roll;
  pivot.rotation.y = 0;

  maybeEmitWake(root, state, dt, !!input.isMobile, speed, maxSpeed, input.wakeRipples);

  state.debug.y = Number(state.y.toFixed(3));
  state.debug.surfaceY = Number(opts.waterSurfaceY.toFixed(3));
  state.debug.pitch = Number(state.pitch.toFixed(3));
  state.debug.roll = Number(state.roll.toFixed(3));
  state.debug.wake = Number(state.wake.toFixed(3));
  return state.debug;
}

export function resetBoatFeel(state) {
  if (!state) return;
  const opts = state.options || BOAT_FEEL_DEFAULTS;
  state.y = clamp(opts.waterlineOffset, opts.minVisualY, opts.maxVisualY);
  state.pitch = 0;
  state.roll = 0;
  state.wake = 0;
  state.prevSpeed = 0;
  state.prevX = null;
  state.prevZ = null;
  state.wakeCooldown = 0;
  if (state.pivot) {
    state.pivot.position.y = state.y;
    state.pivot.rotation.set(0, 0, 0);
  }
  state.debug = {
    y: Number(state.y.toFixed(3)),
    surfaceY: Number((opts.waterSurfaceY || 0).toFixed(3)),
    pitch: 0,
    roll: 0,
    wake: 0,
  };
}

export function getBoatFeelDebug(state) {
  if (!state || !state.debug) return { y: 0, pitch: 0, roll: 0, wake: 0 };
  return {
    y: Number(state.debug.y || 0),
    surfaceY: Number(state.debug.surfaceY || 0),
    pitch: Number(state.debug.pitch || 0),
    roll: Number(state.debug.roll || 0),
    wake: Number(state.debug.wake || 0),
  };
}
