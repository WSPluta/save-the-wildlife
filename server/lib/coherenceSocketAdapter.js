import { ClusterAdapterWithHeartbeat } from "socket.io-adapter";
import { event } from "@oracle/coherence";
import short from "short-uuid";
import {
  DEFAULT_SOCKET_BUS_TTL_MS,
  DEFAULT_SOCKET_EVENT_MAX_PAYLOAD_BYTES,
} from "./realtimeBackend.js";

const EVENT_INSERT = event?.MapEventType?.INSERT || "insert";
const EVENT_UPDATE = event?.MapEventType?.UPDATE || "update";

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function readMapEventValue(mapEvent) {
  if (!mapEvent) return null;
  if (mapEvent.newValue) return mapEvent.newValue;
  if (mapEvent.value) return mapEvent.value;
  return null;
}

function readMapEventKey(mapEvent) {
  if (!mapEvent) return null;
  return mapEvent.key ?? mapEvent.id ?? null;
}

export function createCoherenceAdapter(options) {
  return (nsp) => new CoherenceSocketAdapter(nsp, options);
}

export class CoherenceSocketAdapter extends ClusterAdapterWithHeartbeat {
  constructor(nsp, options = {}) {
    super(nsp, {
      heartbeatInterval: options.heartbeatInterval ?? 5000,
      heartbeatTimeout: options.heartbeatTimeout ?? 10000,
    });
    if (!options.busMap) {
      throw new Error("coherence_socket_adapter_requires_bus_map");
    }
    this.busMap = options.busMap;
    this.serverId = options.serverId || this.uid;
    this.ttlMs = options.ttlMs || DEFAULT_SOCKET_BUS_TTL_MS;
    this.maxPayloadBytes =
      options.maxPayloadBytes || DEFAULT_SOCKET_EVENT_MAX_PAYLOAD_BYTES;
    this.sequence = 0;
    this.listener = new event.MapListener();
    this.listener.on(EVENT_INSERT, (mapEvent) => this.handleMapEvent(mapEvent));
    this.listener.on(EVENT_UPDATE, (mapEvent) => this.handleMapEvent(mapEvent));
    this.listenPromise = this.busMap.addMapListener(this.listener).catch((error) => {
      this.emit("error", error);
    });
    this.busCleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries().catch((error) => this.emit("error", error));
    }, Math.max(1000, Math.min(this.ttlMs, 15000)));
    this.busCleanupTimer.unref?.();
  }

  buildEnvelope(message) {
    const now = Date.now();
    return {
      id: `${now}:${this.serverId}:${++this.sequence}:${short.generate()}`,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      serverId: this.serverId,
      uid: this.uid,
      namespace: this.nsp.name,
      message,
    };
  }

  async doPublish(message) {
    const envelope = this.buildEnvelope(message);
    const payloadSize = byteLength(envelope);
    if (payloadSize > this.maxPayloadBytes) {
      throw new Error(`coherence_socket_event_payload_too_large:${payloadSize}`);
    }
    await this.busMap.set(envelope.id, envelope);
    return envelope.id;
  }

  async doPublishResponse(_requesterUid, response) {
    await this.doPublish(response);
  }

  handleMapEvent(mapEvent) {
    const envelope = readMapEventValue(mapEvent);
    if (!envelope || envelope.namespace !== this.nsp.name || !envelope.message) {
      return;
    }
    if (envelope.serverId === this.serverId || envelope.uid === this.uid) {
      return;
    }
    if (envelope.expiresAt && envelope.expiresAt < Date.now()) {
      const key = readMapEventKey(mapEvent) || envelope.id;
      if (key) {
        this.busMap.delete(key).catch((error) => this.emit("error", error));
      }
      return;
    }
    this.onMessage(envelope.message, envelope.id);
  }

  async cleanupExpiredEntries() {
    if (typeof this.busMap.entries !== "function") return;
    const cutoff = Date.now();
    const entries = await this.busMap.entries();
    for await (const entry of entries) {
      const key = entry.key ?? entry[0];
      const value = entry.value ?? entry[1];
      if (value?.expiresAt && value.expiresAt < cutoff) {
        await this.busMap.delete(key);
      }
    }
  }

  close() {
    clearInterval(this.busCleanupTimer);
    if (this.listener && typeof this.busMap.removeMapListener === "function") {
      this.busMap.removeMapListener(this.listener).catch((error) => this.emit("error", error));
    }
    super.close();
  }
}
