import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getHeightAndNormalInto } from "../buoyancy";
import {
  BOAT_FEEL_DEFAULTS,
  createBoatFeelState,
  getBoatFeelDebug,
  installBoatFeelPivot,
  resetBoatFeel,
  updateBoatFeel,
} from "../boatFeel";

function makeBoatRoot() {
  const root = new THREE.Group();
  root.position.set(1, 0, 2);
  root.rotation.y = 0.45;
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.35, 2),
    new THREE.MeshBasicMaterial()
  );
  root.add(hull);
  return { root, hull };
}

describe("boat feel layer", () => {
  it("starts the visual hull on the waterline instead of lerping down from the air", () => {
    const state = createBoatFeelState();
    const debug = getBoatFeelDebug(state);
    expect(debug.y).toBeLessThanOrEqual(BOAT_FEEL_DEFAULTS.maxVisualY);
    expect(debug.y).toBeGreaterThanOrEqual(BOAT_FEEL_DEFAULTS.minVisualY);
    expect(debug.y).toBe(Number(BOAT_FEEL_DEFAULTS.waterlineOffset.toFixed(3)));
    expect(debug.surfaceY).toBe(Number(BOAT_FEEL_DEFAULTS.waterSurfaceY.toFixed(3)));
    expect(BOAT_FEEL_DEFAULTS.maxVisualY).toBeGreaterThan(0);
    expect(Number((BOAT_FEEL_DEFAULTS.surfaceRippleY - BOAT_FEEL_DEFAULTS.waterlineOffset).toFixed(3))).toBeGreaterThanOrEqual(0.004);
    expect(Number((BOAT_FEEL_DEFAULTS.surfaceRippleY - BOAT_FEEL_DEFAULTS.waterlineOffset).toFixed(3))).toBeLessThanOrEqual(0.012);
  });

  it("samples water into reusable objects with finite normals", () => {
    const target = { normal: new THREE.Vector3() };
    const result = getHeightAndNormalInto(4.5, -2.25, 12.5, target);
    expect(result).toBe(target);
    expect(Number.isFinite(result.height)).toBe(true);
    expect(Number.isFinite(result.normal.x)).toBe(true);
    expect(Number.isFinite(result.normal.y)).toBe(true);
    expect(Number.isFinite(result.normal.z)).toBe(true);
    expect(result.normal.length()).toBeCloseTo(1, 5);
  });

  it("installs a visual-only pivot without moving the gameplay root", () => {
    const { root, hull } = makeBoatRoot();
    const pivot = installBoatFeelPivot(root);
    expect(pivot).toBeTruthy();
    expect(root.children).toContain(pivot);
    expect(pivot.children).toContain(hull);
    expect(root.position.x).toBe(1);
    expect(root.position.z).toBe(2);
    expect(root.rotation.y).toBeCloseTo(0.45);
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.z).toBe(0);
  });

  it("clamps visual y, pitch, and roll under aggressive input and large dt", () => {
    const { root } = makeBoatRoot();
    const state = createBoatFeelState();
    installBoatFeelPivot(root);
    for (let i = 0; i < 20; i += 1) {
      updateBoatFeel(root, state, {
        dt: 0.8,
        time: i * 4,
        speed: i % 2 === 0 ? 18 : -18,
        maxSpeed: 3,
        steer: i % 2 === 0 ? 1 : -1,
      });
    }
    const debug = getBoatFeelDebug(state);
    expect(debug.y).toBeGreaterThanOrEqual(BOAT_FEEL_DEFAULTS.minVisualY);
    expect(debug.y).toBeLessThanOrEqual(BOAT_FEEL_DEFAULTS.maxVisualY);
    expect(Math.abs(debug.pitch)).toBeLessThanOrEqual(BOAT_FEEL_DEFAULTS.maxPitch);
    expect(Math.abs(debug.roll)).toBeLessThanOrEqual(BOAT_FEEL_DEFAULTS.maxRoll);
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.z).toBe(0);
  });

  it("keeps the visual hull close to the rendered waterline instead of sinking", () => {
    const { root } = makeBoatRoot();
    const state = createBoatFeelState();
    installBoatFeelPivot(root);
    for (let i = 0; i < 30; i += 1) {
      root.position.x = Math.sin(i * 0.4) * 12;
      root.position.z = Math.cos(i * 0.33) * 18;
      updateBoatFeel(root, state, {
        dt: 0.05,
        time: i * 1.7,
        speed: 2.4,
        maxSpeed: 3,
        steer: Math.sin(i * 0.2),
      });
    }

    const debug = getBoatFeelDebug(state);
    expect(debug.y).toBeGreaterThanOrEqual(BOAT_FEEL_DEFAULTS.minVisualY);
    expect(debug.y).toBeLessThanOrEqual(BOAT_FEEL_DEFAULTS.maxVisualY);
    expect(debug.y).toBeGreaterThanOrEqual(-0.006);
    expect(debug.y).toBeLessThanOrEqual(0.008);
  });

  it("tracks wake strength and emits bounded ripple visuals through the adapter", () => {
    const { root } = makeBoatRoot();
    const state = createBoatFeelState();
    installBoatFeelPivot(root);
    const ripples = [];
    let splashes = 0;
    updateBoatFeel(root, state, {
      dt: 0.016,
      time: 2,
      speed: 2.6,
      maxSpeed: 3,
      steer: 0.25,
      wakeRipples: {
        emit(position, yaw, strength) {
          ripples.push({
            x: position.x,
            y: position.y,
            z: position.z,
            yaw,
            strength,
          });
        },
      },
      emitters: {
        splash: {
          trigger() {
            splashes += 1;
          },
        },
      },
    });

    const debug = getBoatFeelDebug(state);
    expect(debug.wake).toBeGreaterThan(0);
    expect(debug.wake).toBeLessThanOrEqual(1);
    expect(ripples.length).toBe(1);
    expect(Number.isFinite(ripples[0].y)).toBe(true);
    expect(ripples[0].y).toBeCloseTo(BOAT_FEEL_DEFAULTS.waterSurfaceY + BOAT_FEEL_DEFAULTS.surfaceRippleY, 3);
    expect(ripples[0].strength).toBeGreaterThan(0);
    expect(ripples[0].strength).toBeLessThanOrEqual(1);
    expect(splashes).toBe(0);
  });

  it("resets the visual pivot without touching root yaw or position", () => {
    const { root } = makeBoatRoot();
    const state = createBoatFeelState();
    installBoatFeelPivot(root);
    updateBoatFeel(root, state, {
      dt: 0.016,
      time: 3,
      speed: 2.2,
      maxSpeed: 3,
      steer: 1,
    });
    resetBoatFeel(state);
    expect(getBoatFeelDebug(state)).toEqual({
      y: Number(BOAT_FEEL_DEFAULTS.waterlineOffset.toFixed(3)),
      surfaceY: Number(BOAT_FEEL_DEFAULTS.waterSurfaceY.toFixed(3)),
      pitch: 0,
      roll: 0,
      wake: 0,
    });
    expect(root.position.x).toBe(1);
    expect(root.position.z).toBe(2);
    expect(root.rotation.y).toBeCloseTo(0.45);
  });
});
