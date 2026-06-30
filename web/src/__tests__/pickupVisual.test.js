import { describe, expect, it, vi } from "vitest";
import { hidePickupVisual, restorePickupVisual } from "../pickupVisual.js";

describe("optimistic pickup visuals", () => {
  it("hides and restores an instanced trash item", () => {
    const map = new Map([["trash-1", 4]]);
    const releaseTrashInstance = vi.fn((id) => map.delete(id));
    const setTrashInstance = vi.fn((id) => {
      map.set(id, 4);
      return true;
    });
    const visualState = hidePickupVisual("trash-1", {
      trashInstances: { map },
      releaseTrashInstance,
    });

    expect(visualState).toEqual({ hidden: true, mode: "trash-instance" });
    expect(map.has("trash-1")).toBe(false);
    expect(restorePickupVisual("trash-1", visualState, {
      items: { "trash-1": { position: { x: 1, z: 2 }, size: 1 } },
      trashInstances: { map },
      setTrashInstance,
    })).toBe(true);
    expect(map.has("trash-1")).toBe(true);
  });

  it("hides and restores an instanced powerup", () => {
    const map = new Map([["powerup-1", { idx: 2 }]]);
    const visualState = hidePickupVisual("powerup-1", {
      powerupInstances: { map },
      releasePowerupInstance: (id) => map.delete(id),
    });

    expect(visualState).toEqual({ hidden: true, mode: "powerup-instance" });
    expect(restorePickupVisual("powerup-1", visualState, {
      items: { "powerup-1": { position: { x: 3, z: 4 }, size: 0.8 } },
      powerupInstances: { map },
      setPowerupInstance: (id) => {
        map.set(id, { idx: 2 });
        return true;
      },
    })).toBe(true);
    expect(map.has("powerup-1")).toBe(true);
  });

  it("hides and restores a pooled mesh without changing its transform", () => {
    const mesh = { isObject3D: true, visible: true, position: { x: 5, y: -0.1, z: 6 } };
    const visualState = hidePickupVisual("turtle-1", { itemMeshes: { "turtle-1": mesh } });

    expect(mesh.visible).toBe(false);
    expect(restorePickupVisual("turtle-1", visualState, {
      itemMeshes: { "turtle-1": mesh },
    })).toBe(true);
    expect(mesh.visible).toBe(true);
    expect(mesh.position).toEqual({ x: 5, y: -0.1, z: 6 });
  });

  it("does nothing when no renderable item exists", () => {
    const visualState = hidePickupVisual("missing", {});
    expect(visualState).toEqual({ hidden: false, mode: null });
    expect(restorePickupVisual("missing", visualState, {})).toBe(false);
  });
});
