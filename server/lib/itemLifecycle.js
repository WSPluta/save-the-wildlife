export function reinitializeItemForSpawn(obj, type, options = {}) {
  if (!obj || typeof obj !== "object") return obj;
  const {
    idFactory,
    coordinateFactory,
    worldSizeX = 128,
    worldSizeZ = 42,
    itemMinSize = 0.5,
    itemMaxSize = 0.9,
    random = Math.random,
  } = options;

  if (typeof idFactory === "function") {
    obj.id = idFactory();
  }
  const coord = typeof coordinateFactory === "function"
    ? coordinateFactory
    : (size) => Math.round((random() - 0.5) * (Number(size || 1) - 1));
  const minSize = Number(itemMinSize);
  const maxSize = Number(itemMaxSize);
  const lo = Number.isFinite(minSize) ? minSize : 0.5;
  const hi = Number.isFinite(maxSize) ? Math.max(lo, maxSize) : Math.max(lo, 0.9);

  obj.type = type;
  obj.position = {
    x: coord(worldSizeX),
    y: 0,
    z: coord(worldSizeZ),
  };
  obj.size = (random() * (hi - lo) + lo).toFixed(2);
  delete obj.room;
  return obj;
}

export function snapshotItemForEvent(item) {
  if (!item) return null;
  return {
    id: item.id,
    type: item.type,
    room: item.room,
    size: item.size,
    position: item.position
      ? {
          x: Number(item.position.x || 0),
          y: Number(item.position.y || 0),
          z: Number(item.position.z || 0),
        }
      : null,
  };
}
