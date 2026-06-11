import { describe, expect, it } from "vitest";
import {
  assertRealtimeTopology,
  resolveRealtimeBackend,
  shouldUseCoherence,
  socketBusConfigFromEnv,
} from "../lib/realtimeBackend.js";

describe("realtime backend selection", () => {
  it("defaults to memory for local single-node development", () => {
    expect(resolveRealtimeBackend({})).toBe("memory");
    expect(shouldUseCoherence({})).toBe(false);
  });

  it("enables Coherence when the realtime cluster backend requests it", () => {
    const env = { REALTIME_CLUSTER_BACKEND: "coherence" };
    expect(resolveRealtimeBackend(env)).toBe("coherence");
    expect(shouldUseCoherence(env)).toBe(true);
  });

  it("rejects unknown realtime backends", () => {
    expect(() => resolveRealtimeBackend({ REALTIME_CLUSTER_BACKEND: "redis" }))
      .toThrow(/invalid_realtime_cluster_backend:redis/);
  });

  it("fails production multi-replica startup without Coherence fanout", () => {
    const env = {
      NODE_ENV: "production",
      REALTIME_CLUSTER_BACKEND: "memory",
      WS_SERVER_REPLICAS: "2",
    };
    expect(() => assertRealtimeTopology(env))
      .toThrow(/multi_replica_ws_server_requires_realtime_cluster_backend_coherence/);
  });

  it("uses bounded Coherence bus defaults and env overrides", () => {
    expect(socketBusConfigFromEnv({})).toEqual({
      mapName: "socketEvents",
      ttlMs: 60000,
      maxPayloadBytes: 65536,
    });
    expect(socketBusConfigFromEnv({
      COHERENCE_SOCKET_BUS_MAP: "socketFanout",
      COHERENCE_SOCKET_BUS_TTL_MS: "2500",
      COHERENCE_SOCKET_EVENT_MAX_PAYLOAD_BYTES: "1024",
    })).toEqual({
      mapName: "socketFanout",
      ttlMs: 2500,
      maxPayloadBytes: 1024,
    });
  });
});
