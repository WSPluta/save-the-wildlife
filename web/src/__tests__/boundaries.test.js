import { describe, expect, it } from "vitest";
import {
  WORLD_BOUNDARY_DEFAULTS,
  boundaryMarkerLayout,
  softClampToWorldBoundary,
  worldBoundaryExtents,
} from "../boundaries.js";

describe("world boundaries", () => {
  it("computes boat-safe extents from server world size", () => {
    const extents = worldBoundaryExtents({ width: 128, height: 42 });

    expect(extents.width).toBe(128);
    expect(extents.height).toBe(42);
    expect(extents.boatMargin).toBe(WORLD_BOUNDARY_DEFAULTS.boatMargin);
    expect(extents.halfX).toBeCloseTo(62.75);
    expect(extents.halfZ).toBeCloseTo(19.75);
  });

  it("soft-clamps positions and reports the visible edge cue", () => {
    const result = softClampToWorldBoundary(
      { x: 80, z: -25 },
      { width: 128, height: 42 },
      { boatMargin: 1.25 }
    );

    expect(result.hit).toBe(true);
    expect(result.hitX).toBe(true);
    expect(result.hitZ).toBe(true);
    expect(result.edge).toBe("corner");
    expect(result.x).toBeCloseTo(62.75);
    expect(result.z).toBeCloseTo(-19.75);
  });

  it("lays out sparse marker points around the map", () => {
    const layout = boundaryMarkerLayout({ width: 128, height: 42 }, { spacing: 16 });

    expect(layout.markers.length).toBeGreaterThan(12);
    expect(new Set(layout.markers.map((marker) => marker.edge))).toEqual(new Set(["north", "south", "east", "west"]));
    expect(layout.markers.every((marker) => Math.abs(marker.x) <= layout.extents.halfX)).toBe(true);
    expect(layout.markers.every((marker) => Math.abs(marker.z) <= layout.extents.halfZ)).toBe(true);
  });
});
