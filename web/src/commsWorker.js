import { io } from "socket.io-client";

let socket;
let savedInit = null;
let DEBUG_WORKER = false;
let networkStatsInterval = null;
let networkPingInterval = null;
let traceBatchTimer = null;
let queuedTrace = null;
let currentEngine = null;
let enginePacketListener = null;
let enginePacketCreateListener = null;

const networkStats = {
  upBytesWindow: 0,
  downBytesWindow: 0,
  upKbps: 0,
  downKbps: 0,
  rttMs: null,
  quality: "unknown",
  pingsSent: 0,
  pingsOk: 0,
  pingsTimeout: 0,
};

function estimateBytes(payload) {
  if (payload == null) return 0;
  try {
    if (typeof payload === "string") return new TextEncoder().encode(payload).length;
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch (_) {
    return 0;
  }
}

function qualityFromStats(rttMs, lossRate) {
  if (!Number.isFinite(rttMs)) return "unknown";
  if (lossRate >= 0.2 || rttMs > 250) return "poor";
  if (lossRate >= 0.08 || rttMs > 140) return "fair";
  return "good";
}

function attachEnginePacketTracking() {
  try {
    const engine = socket && socket.io ? socket.io.engine : null;
    if (!engine || engine === currentEngine) return;
    detachEnginePacketTracking();
    currentEngine = engine;
    enginePacketListener = (packet) => {
      networkStats.downBytesWindow += estimateBytes(packet && packet.data);
    };
    enginePacketCreateListener = (packet) => {
      networkStats.upBytesWindow += estimateBytes(packet && packet.data);
    };
    engine.on("packet", enginePacketListener);
    engine.on("packetCreate", enginePacketCreateListener);
  } catch (_) {}
}

function detachEnginePacketTracking() {
  try {
    if (currentEngine && enginePacketListener) {
      currentEngine.off("packet", enginePacketListener);
    }
    if (currentEngine && enginePacketCreateListener) {
      currentEngine.off("packetCreate", enginePacketCreateListener);
    }
  } catch (_) {}
  currentEngine = null;
  enginePacketListener = null;
  enginePacketCreateListener = null;
}

function flushTraceBatch() {
  if (!socket || !queuedTrace) return;
  try {
    socket.emit("player.trace.change", queuedTrace);
  } catch (_) {}
  queuedTrace = null;
}

function queueTrace(trace) {
  queuedTrace = {
    c: 1,
    i: trace && trace.id ? trace.id : null,
    x: Math.round((Number(trace && trace.x) || 0) * 1000),
    z: Math.round((Number(trace && trace.z) || 0) * 1000),
    r: Math.round((Number(trace && trace.rotY) || 0) * 10000),
  };
  if (traceBatchTimer) return;
  traceBatchTimer = setTimeout(() => {
    traceBatchTimer = null;
    flushTraceBatch();
  }, 50);
}

function startNetworkMonitoring() {
  stopNetworkMonitoring();
  attachEnginePacketTracking();

  networkStatsInterval = setInterval(() => {
    const sent = Math.max(1, networkStats.pingsSent);
    const lossRate = networkStats.pingsTimeout / sent;
    networkStats.upKbps = Number(((networkStats.upBytesWindow * 8) / 1024).toFixed(2));
    networkStats.downKbps = Number(((networkStats.downBytesWindow * 8) / 1024).toFixed(2));
    networkStats.quality = qualityFromStats(networkStats.rttMs, lossRate);
    postMessage({
      type: "network.stats",
      body: {
        upKbps: networkStats.upKbps,
        downKbps: networkStats.downKbps,
        rttMs: networkStats.rttMs,
        quality: networkStats.quality,
        lossRate: Number(lossRate.toFixed(3)),
      },
    });
    networkStats.upBytesWindow = 0;
    networkStats.downBytesWindow = 0;
  }, 1000);

  networkPingInterval = setInterval(() => {
    if (!socket || !socket.connected) return;
    const startTs = Date.now();
    networkStats.pingsSent++;
    try {
      socket.timeout(1500).emit("client.ping", { clientTs: startTs }, (err, res) => {
        if (err) {
          networkStats.pingsTimeout++;
          return;
        }
        networkStats.pingsOk++;
        const now = Date.now();
        const measured = Number(res && res.serverTs) ? now - startTs : now - startTs;
        networkStats.rttMs = Math.max(1, Math.round(measured));
      });
    } catch (_) {
      networkStats.pingsTimeout++;
    }
  }, 2000);
}

function stopNetworkMonitoring() {
  if (networkStatsInterval) {
    clearInterval(networkStatsInterval);
    networkStatsInterval = null;
  }
  if (networkPingInterval) {
    clearInterval(networkPingInterval);
    networkPingInterval = null;
  }
  if (traceBatchTimer) {
    clearTimeout(traceBatchTimer);
    traceBatchTimer = null;
  }
  flushTraceBatch();
  detachEnginePacketTracking();
}

function init(wsURL, yourId, yourName, room, clientSessionId = null, debugWorker = false, isPresenter = false) {
  DEBUG_WORKER = !!debugWorker;
  logger(`WebWorker commsWorker start on ${wsURL}`);
  savedInit = { wsURL, yourId, yourName, room, clientSessionId, debugWorker: DEBUG_WORKER, isPresenter: !!isPresenter };
  socket = io(wsURL, {
    transports: ["websocket"],
    withCredentials: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5
  });

  // Socket.IO Manager-level diagnostics (connection lifecycle)
  socket.io.on("reconnect_attempt", (attempt) => logger(`reconnect_attempt #${attempt}`));
  socket.io.on("reconnect_error", (error) => postMessage({ type: "error", body: `reconnect_error: ${error && error.message ? error.message : error}` }));
  socket.io.on("reconnect_failed", () => logger("reconnect_failed"));
  socket.io.on("reconnect", (attempt) => logger(`reconnect after #${attempt}`));
  socket.io.on("open", () => {
    logger("manager open");
    attachEnginePacketTracking();
  });
  socket.io.on("close", (reason) => logger(`manager close: ${reason}`));
  socket.io.on("error", (error) => postMessage({ type: "error", body: `manager error: ${error && error.message ? error.message : error}` }));

  logger(`I am ${yourName} with id ${yourId} joining the game${room ? ` room=${room}` : ""}${isPresenter ? " as presenter" : ""}`);
  if (!isPresenter) {
    socket.emit("player.info.joining", { id: yourId, name: yourName, room, clientSessionId });
  }

  socket.io.on("error", (error) => postMessage({ error }));

  socket.on("connect_error", (error) => postMessage({ error }));

  socket.on("connect", () => {
    logger("connect");
    postMessage({ type: "connect" });
    attachEnginePacketTracking();
    try {
      if (savedInit && !savedInit.isPresenter) {
        socket.emit("player.info.joining", {
          id: savedInit.yourId,
          name: savedInit.yourName,
          room: savedInit.room,
          clientSessionId: savedInit.clientSessionId,
        });
      }
    } catch (_) {}
  });

  socket.on("disconnect", (reason) => {
    logger(`disconnect: ${reason}`);
    postMessage({ type: "disconnect", body: { reason } });
  });

  socket.on("player.trace.all", (data) => {
    delete data[yourId];
    postMessage({ type: "player.trace.all", body: data });
  });

  socket.on("game.end", () => {
    postMessage({ type: "game.end" });
  });

  socket.on("commentary.ready", (data) => {
    postMessage({ type: "commentary.ready", body: data });
  });

  socket.on("items.all", (data) => {
    postMessage({ type: "items.all", body: data });
  });

  socket.on("item.new", (data) => {
    postMessage({ type: "item.new", body: data });
  });

  socket.on("item.destroy", (data) => {
    postMessage({ type: "item.destroy", body: data });
  });

  socket.on("server.info", (data) => {
    postMessage({ type: "server.info", body: data });
  });

  // Forward authoritative game state and shared timer from server to UI
  socket.on("game.state", (data) => {
    postMessage({ type: "game.state", body: data });
  });

  socket.on("game.time", (data) => {
    postMessage({ type: "game.time", body: data });
  });

  // Authoritative server state snapshots (optional feature)
  socket.on("player.state", (data) => {
    postMessage({ type: "player.state", body: data });
  });

  // New: synchronized pre-start countdown and player counts
  socket.on("startingGame", (data) => {
    postMessage({ type: "startingGame", body: data });
  });

  socket.on("player.count", (data) => {
    postMessage({ type: "player.count", body: data });
  });

  // Server metrics for debug Object Monitor
  socket.on("server.metrics", (data) => {
    postMessage({ type: "server.metrics", body: data });
  });

  // Rooms directory and join acknowledgement
  socket.on("rooms.update", (data) => {
    postMessage({ type: "rooms.update", body: data });
  });

  socket.on("room.joined", (data) => {
    try { if (data && data.id) savedInit = { ...(savedInit || {}), room: data.id }; } catch (_) {}
    postMessage({ type: "room.joined", body: data });
  });

  // Current room admin assignment/changes
  socket.on("room.admin", (data) => {
    postMessage({ type: "room.admin", body: data });
  });

  socket.on("player.info.all", (data) => {
    delete data[yourId];
    postMessage({ type: "player.info.all", body: data });
  });

  socket.on("game.on", (data) => {
    postMessage({ type: "game.on", body: data });
  });

  socket.on("player.info.joined", (data) => {
    postMessage({ type: "player.info.joined", body: data });
  });

  socket.on("player.session", (data) => {
    postMessage({ type: "player.session", body: data });
  });

  socket.on("player.info.left", (data) => {
    postMessage({ type: "player.info.left", body: data });
  });

  // Lobby chat and players list
  socket.on("chat.history", (data) => {
    postMessage({ type: "chat.history", body: data });
  });
  socket.on("chat.message", (data) => {
    postMessage({ type: "chat.message", body: data });
  });
  socket.on("lobby.players", (data) => {
    postMessage({ type: "lobby.players", body: data });
  });
  startNetworkMonitoring();
}

function generateCmdId() {
  try { return crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; } catch (_) { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

function emitWithAck(event, payload = {}, opts = {}) {
  const tries = Number.isFinite(opts.tries) ? opts.tries : 3;
  const baseTimeout = Number.isFinite(opts.timeout) ? opts.timeout : 1000;
  const jitter = Number.isFinite(opts.jitter) ? opts.jitter : 0.2;
  const cmdId = payload.cmdId || generateCmdId();
  const body = { ...payload, cmdId };

  return new Promise((resolve, reject) => {
    let attempt = 0;
    let timeout = baseTimeout;

    const send = () => {
      attempt++;
      try {
        socket.timeout(timeout).emit(event, body, (err, res) => {
          if (!err && res && (res.ok || res.duplicate)) {
            resolve(res);
            return;
          }
          if (attempt >= tries) {
            reject(err || new Error(res && res.error ? res.error : "ack_failed"));
            return;
          }
          const jitterMs = Math.round(timeout * jitter * Math.random());
          timeout = Math.min(timeout * 2, 2000);
          setTimeout(send, timeout + jitterMs);
        });
      } catch (e) {
        if (attempt >= tries) return reject(e);
        const jitterMs = Math.round(timeout * jitter * Math.random());
        timeout = Math.min(timeout * 2, 2000);
        setTimeout(send, timeout + jitterMs);
      }
    };

    send();
  });
}

onmessage = ({ data }) => {
  switch (data.type) {
    case "player.trace.change":
      queueTrace(data.body);
      break;
    case "game.start":
      logger("game.start");
      socket.emit("game.start", data.body);
      break;
    case "close":
      logger("Socket closing");
      stopNetworkMonitoring();
      socket.close();
      break;
    case "items.collision":
      socket.timeout(1200).emit("items.collision", data.body, (err, res) => {
        if (err) {
          postMessage({
            type: "items.collision.result",
            body: {
              ok: false,
              error: err && err.message ? err.message : String(err),
              itemId: data.body && data.body.itemId,
            },
          });
          return;
        }
        postMessage({ type: "items.collision.result", body: res || { ok: false, itemId: data.body && data.body.itemId } });
      });
      break;
    case "game.event":
      socket.emit("game.event", data.body, (res) => {
        if (res && res.commentary) {
          postMessage({ type: "commentary.ready", body: res.commentary });
        }
      });
      break;
    case "player.input":
      // data.body: { id, seq, throttle, steer, brake }
      socket.emit("player.input", data.body);
      break;
    case "chat.send":
      // data.body: { text }
      socket.emit("chat.send", data.body);
      break;
    case "player.info.joining":
      // allow updating name while in lobby
      try {
        if (data && data.body) {
          savedInit = {
            ...(savedInit || {}),
            yourId: data.body.id || savedInit?.yourId,
            yourName: data.body.name || savedInit?.yourName,
            room: data.body.room || savedInit?.room,
            clientSessionId: data.body.clientSessionId || savedInit?.clientSessionId,
          };
        }
      } catch (_) {}
      socket.emit("player.info.joining", data.body);
      break;
    case "init":
      const { wsURL, yourId, yourName, room, clientSessionId, debugWorker, isPresenter } = data.body;
      init(wsURL, yourId, yourName, room, clientSessionId, !!debugWorker, !!isPresenter);
      break;
    case "admin.start":
      logger("admin.start");
      postMessage({ type: "admin.start.requested" });
      emitWithAck("admin.start", {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.start.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.start.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.presenter.start":
      logger("admin.presenter.start");
      postMessage({ type: "admin.presenter.start.requested", body: data.body || {} });
      emitWithAck("admin.presenter.start", data.body || {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.presenter.start.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.presenter.start.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.end":
      logger("admin.end");
      postMessage({ type: "admin.end.requested" });
      emitWithAck("admin.end", {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.end.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.end.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.presenter.end":
      logger("admin.presenter.end");
      postMessage({ type: "admin.presenter.end.requested", body: data.body || {} });
      emitWithAck("admin.presenter.end", data.body || {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.presenter.end.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.presenter.end.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.presenter.grant":
      logger("admin.presenter.grant");
      postMessage({ type: "admin.presenter.grant.requested", body: data.body || {} });
      emitWithAck("admin.presenter.grant", data.body || {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.presenter.grant.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.presenter.grant.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.spawnMode.set":
      // data.body: { mode, params }
      socket.emit("admin.spawnMode.set", data.body);
      break;
    case "admin.worldScaling.set":
      // data.body: { minX, minZ, maxX, maxZ, baseX?, baseZ?, basePlayers?, densityPerPlayer? }
      socket.emit("admin.worldScaling.set", data.body);
      break;
    case "room.join":
      // data.body: { id?: string } - if omitted or invalid, server assigns default
      try { if (data && data.body && data.body.id) savedInit = { ...(savedInit || {}), room: data.body.id }; } catch (_) {}
      socket.emit("room.join", data.body || {});
      break;
    case "room.create":
      // data.body: { id?: string }
      postMessage({ type: "room.create.requested", body: data.body || {} });
      emitWithAck("room.create", data.body || {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => {
          try { if (res && res.id) savedInit = { ...(savedInit || {}), room: res.id }; } catch (_) {}
          postMessage({ type: "room.create.confirmed", body: res });
        })
        .catch((err) => postMessage({ type: "room.create.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.grant":
      // data.body: { id: string }
      postMessage({ type: "admin.grant.requested", body: data.body || {} });
      emitWithAck("admin.grant", data.body || {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.grant.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.grant.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    default:
      break;
  }
};

function logger(message) {
  if (!DEBUG_WORKER) return;
  const ts = new Date().toISOString();
  postMessage({
    type: "log",
    body: `[${ts}] Comms Worker: ${typeof message === "string" ? message : JSON.stringify(message)}`,
  });
}
