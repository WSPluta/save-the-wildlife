function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function pickupScoreDelta(itemType, { shielded = false } = {}) {
  const type = String(itemType || "").toLowerCase();
  if (type.startsWith("powerup_")) return 0;
  if (type === "turtle" || type.startsWith("marine")) return shielded ? 0 : -1;
  return 1;
}

export function beginOptimisticPickupScore(currentScore, itemType, options = {}) {
  const current = finiteNumber(currentScore) ?? 0;
  const delta = pickupScoreDelta(itemType, options);
  return {
    score: Math.round(current + delta),
    delta,
    applied: delta !== 0,
  };
}

export function reconcilePickupScore({
  currentScore,
  pending,
  payload = {},
  itemType,
  shielded = false,
  pendingScoreDelta = 0,
} = {}) {
  const authoritative = finiteNumber(payload.score, payload.serverScore);
  if (Number.isFinite(authoritative)) {
    const remainingPending = finiteNumber(pendingScoreDelta) ?? 0;
    return Math.round(authoritative + remainingPending);
  }
  const current = finiteNumber(currentScore) ?? 0;
  const payloadDelta = finiteNumber(payload.scoreDelta);
  if (pending?.optimisticApplied) {
    if (!Number.isFinite(payloadDelta)) return Math.round(current);
    const optimisticDelta = finiteNumber(pending.optimisticDelta) ?? 0;
    return Math.round(current + payloadDelta - optimisticDelta);
  }
  const delta = Number.isFinite(payloadDelta)
    ? payloadDelta
    : pickupScoreDelta(itemType, { shielded });
  return Math.round(current + delta);
}

export function rollbackOptimisticPickupScore(currentScore, pending) {
  const current = finiteNumber(currentScore) ?? 0;
  if (!pending?.optimisticApplied) return Math.round(current);
  const delta = finiteNumber(pending.optimisticDelta) ?? 0;
  return Math.round(current - delta);
}
