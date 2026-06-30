export const WORLD_BOUNDARY_DEFAULTS = Object.freeze({
  boatMargin: 1.25,
  itemEdgeInset: 1,
  markerSpacing: 12,
  mobileMarkerSpacing: 16,
  speedDamping: 0.35,
});

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function worldBoundaryExtents(boundaries = {}, options = {}) {
  const width = Math.max(1, finiteNumber(boundaries.width, 100));
  const height = Math.max(1, finiteNumber(boundaries.height, 100));
  const boatMargin = Math.max(0, finiteNumber(options.boatMargin, WORLD_BOUNDARY_DEFAULTS.boatMargin));
  const halfX = Math.max(0.1, width / 2 - boatMargin);
  const halfZ = Math.max(0.1, height / 2 - boatMargin);
  return { width, height, halfX, halfZ, boatMargin };
}

export function softClampToWorldBoundary(position = {}, boundaries = {}, options = {}) {
  const extents = worldBoundaryExtents(boundaries, options);
  const x = finiteNumber(position.x, 0);
  const z = finiteNumber(position.z, 0);
  const clampedX = Math.max(-extents.halfX, Math.min(extents.halfX, x));
  const clampedZ = Math.max(-extents.halfZ, Math.min(extents.halfZ, z));
  const hitX = clampedX !== x;
  const hitZ = clampedZ !== z;
  const edge = hitX && hitZ
    ? "corner"
    : hitX
    ? (x < 0 ? "west" : "east")
    : hitZ
    ? (z < 0 ? "south" : "north")
    : null;

  return {
    x: clampedX,
    z: clampedZ,
    hit: hitX || hitZ,
    hitX,
    hitZ,
    edge,
    extents,
  };
}

export function boundaryMarkerLayout(boundaries = {}, options = {}) {
  const extents = worldBoundaryExtents(boundaries, options);
  const mobile = !!options.mobile;
  const spacing = Math.max(6, finiteNumber(
    options.spacing,
    mobile ? WORLD_BOUNDARY_DEFAULTS.mobileMarkerSpacing : WORLD_BOUNDARY_DEFAULTS.markerSpacing
  ));
  const markers = [];
  const addMarker = (x, z, edge, accentIndex) => {
    markers.push({
      x: Number(x.toFixed(3)),
      z: Number(z.toFixed(3)),
      edge,
      accentIndex,
    });
  };
  const xSteps = Math.max(2, Math.ceil((extents.halfX * 2) / spacing));
  const zSteps = Math.max(2, Math.ceil((extents.halfZ * 2) / spacing));

  for (let i = 0; i <= xSteps; i += 1) {
    const x = -extents.halfX + (i / xSteps) * extents.halfX * 2;
    addMarker(x, extents.halfZ, "north", i);
    addMarker(x, -extents.halfZ, "south", i);
  }
  for (let i = 1; i < zSteps; i += 1) {
    const z = -extents.halfZ + (i / zSteps) * extents.halfZ * 2;
    addMarker(extents.halfX, z, "east", i);
    addMarker(-extents.halfX, z, "west", i);
  }

  return {
    extents,
    spacing,
    markers,
  };
}
