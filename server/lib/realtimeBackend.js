export const REALTIME_BACKENDS = new Set(["coherence", "memory"]);

export const DEFAULT_SOCKET_BUS_MAP = "socketEvents";
export const DEFAULT_SOCKET_BUS_TTL_MS = 60000;
export const DEFAULT_SOCKET_EVENT_MAX_PAYLOAD_BYTES = 65536;

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveRealtimeBackend(env = process.env) {
  const requested = String(env.REALTIME_CLUSTER_BACKEND || "").trim().toLowerCase();
  if (requested) {
    if (!REALTIME_BACKENDS.has(requested)) {
      throw new Error(`invalid_realtime_cluster_backend:${requested}`);
    }
    return requested;
  }
  return "memory";
}

export function shouldUseCoherence(env = process.env) {
  return env.ENABLE_COHERENCE_BACKEND === "true" || resolveRealtimeBackend(env) === "coherence";
}

export function socketBusConfigFromEnv(env = process.env) {
  return {
    mapName: env.COHERENCE_SOCKET_BUS_MAP || DEFAULT_SOCKET_BUS_MAP,
    ttlMs: asPositiveInteger(env.COHERENCE_SOCKET_BUS_TTL_MS, DEFAULT_SOCKET_BUS_TTL_MS),
    maxPayloadBytes: asPositiveInteger(
      env.COHERENCE_SOCKET_EVENT_MAX_PAYLOAD_BYTES,
      DEFAULT_SOCKET_EVENT_MAX_PAYLOAD_BYTES
    ),
  };
}

export function requestedReplicaCount(env = process.env) {
  return asPositiveInteger(
    env.WS_SERVER_REPLICAS || env.REPLICA_COUNT || env.KUBERNETES_REPLICA_COUNT,
    1
  );
}

export function assertRealtimeTopology(env = process.env) {
  const backend = resolveRealtimeBackend(env);
  const replicas = requestedReplicaCount(env);
  if (env.NODE_ENV === "production" && replicas > 1 && backend !== "coherence") {
    throw new Error("multi_replica_ws_server_requires_realtime_cluster_backend_coherence");
  }
  return { backend, replicas };
}
