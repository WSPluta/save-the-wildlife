import { describe, expect, it, vi } from "vitest";
import {
  CoherenceSocketAdapter,
  createCoherenceAdapter,
} from "../lib/coherenceSocketAdapter.js";

class FakeBusMap {
  constructor() {
    this.store = new Map();
    this.listeners = new Set();
  }

  async set(key, value) {
    this.store.set(key, value);
    for (const listener of this.listeners) {
      listener.emit("insert", { key, newValue: value });
    }
    return null;
  }

  async delete(key) {
    this.store.delete(key);
    return null;
  }

  async addMapListener(listener) {
    this.listeners.add(listener);
  }

  async removeMapListener(listener) {
    this.listeners.delete(listener);
  }

  async *entries() {
    for (const [key, value] of this.store.entries()) {
      yield { key, value };
    }
  }
}

function fakeNamespace() {
  return {
    name: "/",
    sockets: new Map(),
    _ids: 0,
    server: {
      opts: {},
      encoder: {
        encode(packet) {
          return [JSON.stringify(packet)];
        },
      },
    },
    _onServerSideEmit() {},
  };
}

function makeAdapter(options = {}) {
  const adapter = new CoherenceSocketAdapter(fakeNamespace(), {
    busMap: new FakeBusMap(),
    serverId: "local-server",
    ttlMs: 1000,
    maxPayloadBytes: 4096,
    ...options,
  });
  return adapter;
}

describe("Coherence Socket.IO adapter", () => {
  it("returns a Socket.IO adapter constructor from the factory", () => {
    const busMap = new FakeBusMap();
    const AdapterConstructor = createCoherenceAdapter({
      busMap,
      serverId: "local-server",
      ttlMs: 1000,
      maxPayloadBytes: 4096,
    });
    const adapter = new AdapterConstructor(fakeNamespace());

    expect(adapter).toBeInstanceOf(CoherenceSocketAdapter);
    adapter.close();
  });

  it("publishes cluster messages to the Coherence bus and self-skips the map event", async () => {
    const busMap = new FakeBusMap();
    const adapter = makeAdapter({ busMap });
    const seen = [];
    adapter.onMessage = (message, offset) => seen.push({ message, offset });

    const offset = await adapter.doPublish({ type: 3, nsp: "/", data: { ok: true } });

    expect(busMap.store.has(offset)).toBe(true);
    expect(seen).toEqual([]);
    adapter.close();
  });

  it("delivers remote map events into the Socket.IO cluster adapter", () => {
    const adapter = makeAdapter();
    const seen = [];
    adapter.onMessage = (message, offset) => seen.push({ message, offset });

    adapter.handleMapEvent({
      key: "remote-offset",
      newValue: {
        id: "remote-offset",
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000,
        serverId: "remote-server",
        uid: "remote-uid",
        namespace: "/",
        message: { uid: "remote-uid", nsp: "/", type: 3, data: { event: "admin.start" } },
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].offset).toBe("remote-offset");
    expect(seen[0].message.data.event).toBe("admin.start");
    adapter.close();
  });

  it("fans out room broadcasts between two ws-server adapters on one Coherence bus", async () => {
    const busMap = new FakeBusMap();
    const localNamespace = fakeNamespace();
    const remoteNamespace = fakeNamespace();
    const localAdapter = new CoherenceSocketAdapter(localNamespace, {
      busMap,
      serverId: "local-server",
      ttlMs: 1000,
      maxPayloadBytes: 4096,
    });
    const remoteAdapter = new CoherenceSocketAdapter(remoteNamespace, {
      busMap,
      serverId: "remote-server",
      ttlMs: 1000,
      maxPayloadBytes: 4096,
    });
    const delivered = [];
    remoteNamespace.sockets.set("remote-socket", {
      id: "remote-socket",
      rooms: new Set(["remote-socket", "ROOM-1"]),
      acks: new Map(),
      data: {},
      handshake: {},
      client: {
        writeToEngine(encodedPackets, packetOpts) {
          delivered.push({ encodedPackets, packetOpts });
        },
      },
    });
    remoteAdapter.addAll("remote-socket", new Set(["remote-socket", "ROOM-1"]));

    await localAdapter.broadcast(
      { type: 2, data: ["admin.start", { room: "ROOM-1" }] },
      { rooms: new Set(["ROOM-1"]), except: new Set(), flags: {} }
    );

    expect(delivered).toHaveLength(1);
    expect(delivered[0].encodedPackets[0]).toContain("admin.start");
    expect(delivered[0].encodedPackets[0]).toContain("ROOM-1");
    localAdapter.close();
    remoteAdapter.close();
  });

  it("removes expired bus entries during TTL cleanup", async () => {
    const busMap = new FakeBusMap();
    const adapter = makeAdapter({ busMap });
    busMap.store.set("old", {
      id: "old",
      expiresAt: Date.now() - 10,
      namespace: "/",
      message: { uid: "remote" },
    });

    await adapter.cleanupExpiredEntries();

    expect(busMap.store.has("old")).toBe(false);
    adapter.close();
  });

  it("logs Coherence bus cleanup failures without emitting a fatal error event", async () => {
    const busMap = new FakeBusMap();
    busMap.delete = vi.fn(async () => {
      const error = new Error("coherence deadline");
      error.code = 4;
      throw error;
    });
    const logger = { warn: vi.fn() };
    const adapter = makeAdapter({ busMap, logger });
    const busErrors = [];
    adapter.on("bus.error", (payload) => busErrors.push(payload));
    busMap.store.set("old", {
      id: "old",
      expiresAt: Date.now() - 10,
      namespace: "/",
      message: { uid: "remote" },
    });

    await adapter.cleanupExpiredEntries();

    expect(busMap.delete).toHaveBeenCalledWith("old");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0].context).toBe("cleanupExpiredEntry");
    expect(busErrors).toHaveLength(1);
    adapter.close();
  });

  it("rejects oversized fanout payloads before writing to Coherence", async () => {
    const busMap = new FakeBusMap();
    const adapter = makeAdapter({ busMap, maxPayloadBytes: 128 });

    await expect(adapter.doPublish({ type: 3, nsp: "/", data: "x".repeat(256) }))
      .rejects.toThrow(/coherence_socket_event_payload_too_large/);
    expect(busMap.store.size).toBe(0);
    adapter.close();
  });
});
