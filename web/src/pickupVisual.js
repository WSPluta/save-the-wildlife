export function hidePickupVisual(itemId, {
  trashInstances,
  powerupInstances,
  itemMeshes,
  releaseTrashInstance,
  releasePowerupInstance,
} = {}) {
  if (!itemId) return { hidden: false, mode: null };

  if (trashInstances?.map?.has(itemId)) {
    releaseTrashInstance?.(itemId);
    return { hidden: true, mode: "trash-instance" };
  }
  if (powerupInstances?.map?.has(itemId)) {
    releasePowerupInstance?.(itemId);
    return { hidden: true, mode: "powerup-instance" };
  }

  const mesh = itemMeshes?.[itemId];
  if (mesh?.isObject3D) {
    const wasVisible = mesh.visible !== false;
    mesh.visible = false;
    return { hidden: true, mode: "mesh", wasVisible };
  }
  return { hidden: false, mode: null };
}

export function restorePickupVisual(itemId, visualState = {}, {
  items,
  trashInstances,
  powerupInstances,
  itemMeshes,
  setTrashInstance,
  setPowerupInstance,
} = {}) {
  if (!itemId || visualState?.hidden !== true) return false;
  const item = items?.[itemId];

  if (visualState.mode === "trash-instance" && item && !trashInstances?.map?.has(itemId)) {
    return setTrashInstance?.(itemId, item.position, item.size) === true;
  }
  if (visualState.mode === "powerup-instance" && item && !powerupInstances?.map?.has(itemId)) {
    return setPowerupInstance?.(itemId, item.position, item.size) === true;
  }
  if (visualState.mode === "mesh") {
    const mesh = itemMeshes?.[itemId];
    if (!mesh?.isObject3D) return false;
    mesh.visible = visualState.wasVisible !== false;
    return true;
  }
  return false;
}
