let snapshotProvider = null;

export function setObservabilitySnapshotProvider(provider) {
  snapshotProvider = typeof provider === "function" ? provider : null;
}

export async function getObservabilitySnapshot(options = {}) {
  if (!snapshotProvider) {
    return {
      ok: false,
      status: "starting",
      source: "canonical-observability",
      generatedAt: new Date().toISOString(),
      reason: "observability_provider_not_ready",
      requestedRoom: options.room || null,
    };
  }
  return snapshotProvider(options);
}
