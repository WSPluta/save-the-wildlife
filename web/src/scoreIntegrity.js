export function finiteScoreNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function scoreMapValueForPlayer(map, playerId) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const key = String(playerId || "").trim();
  if (!key) return null;
  return finiteScoreNumber(map[key]);
}

export function endPayloadHasAuthoritativeScores(endPayload = {}) {
  if (!endPayload || typeof endPayload !== "object") return false;
  const source = String(endPayload.scoreSource || endPayload.score_source || "").trim();
  return endPayload.authoritativeScores === true ||
    endPayload.scoresAuthoritative === true ||
    endPayload.finalScoresAuthoritative === true ||
    source === "server_room_state";
}

export function authoritativeFinalScoreFromEndPayload(endPayload = {}, playerId = "") {
  if (!endPayloadHasAuthoritativeScores(endPayload)) return null;
  return finiteScoreNumber(
    scoreMapValueForPlayer(endPayload.scores, playerId),
    scoreMapValueForPlayer(endPayload.final_scores, playerId),
    scoreMapValueForPlayer(endPayload.finalScores, playerId),
    scoreMapValueForPlayer(endPayload.score_by_player, playerId),
    scoreMapValueForPlayer(endPayload.scoreByPlayer, playerId),
    endPayload.playerId === playerId ? endPayload.final_score : null,
    endPayload.playerId === playerId ? endPayload.finalScore : null,
    endPayload.playerId === playerId ? endPayload.score : null
  );
}

export function finalScoreFromSources({
  endPayload = {},
  playerId = "",
  localScore = 0,
  fallbackScore = 0,
} = {}) {
  const authoritativeScore = authoritativeFinalScoreFromEndPayload(endPayload, playerId);
  if (Number.isFinite(authoritativeScore)) return Math.round(authoritativeScore);
  const local = finiteScoreNumber(localScore);
  if (Number.isFinite(local)) return Math.round(local);
  const unmarkedEndScore = finiteScoreNumber(
    scoreMapValueForPlayer(endPayload?.scores, playerId),
    scoreMapValueForPlayer(endPayload?.finalScores, playerId),
    scoreMapValueForPlayer(endPayload?.scoreByPlayer, playerId),
    endPayload?.playerId === playerId ? endPayload?.final_score : null,
    endPayload?.playerId === playerId ? endPayload?.finalScore : null,
    endPayload?.playerId === playerId ? endPayload?.score : null
  );
  if (Number.isFinite(unmarkedEndScore)) return Math.round(unmarkedEndScore);
  const fallback = finiteScoreNumber(fallbackScore);
  return Number.isFinite(fallback) ? Math.round(fallback) : 0;
}
