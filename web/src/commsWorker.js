import { io } from "socket.io-client";

let socket;
let savedInit = null;
let DEBUG_WORKER = false;

function init(wsURL, yourId, yourName, room, debugWorker = false) {
  DEBUG_WORKER = !!debugWorker;
  logger(`WebWorker commsWorker start on ${wsURL}`);
  savedInit = { wsURL, yourId, yourName, room, debugWorker: DEBUG_WORKER };
  socket = io(wsURL, {
    transports: ["websocket", "polling"],
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
  socket.io.on("open", () => logger("manager open"));
  socket.io.on("close", (reason) => logger(`manager close: ${reason}`));
  socket.io.on("error", (error) => postMessage({ type: "error", body: `manager error: ${error && error.message ? error.message : error}` }));

  logger(`I am ${yourName} with id ${yourId} joining the game${room ? ` room=${room}` : ""}`);
  socket.emit("player.info.joining", { id: yourId, name: yourName, room });

  socket.io.on("error", (error) => postMessage({ error }));

  socket.on("connect_error", (error) => postMessage({ error }));

  socket.on("connect", () => {
    logger("connect");
    postMessage({ type: "connect" });
    try {
      if (savedInit) {
        socket.emit("player.info.joining", { id: savedInit.yourId, name: savedInit.yourName, room: savedInit.room });
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
      socket.emit("player.trace.change", data.body);
      break;
    case "game.start":
      logger("game.start");
      socket.emit("game.start", data.body);
      break;
    case "close":
      logger("Socket closing");
      socket.close();
      break;
    case "items.collision":
      socket.emit("items.collision", data.body);
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
      socket.emit("player.info.joining", data.body);
      break;
    case "init":
      const { wsURL, yourId, yourName, room, debugWorker } = data.body;
      init(wsURL, yourId, yourName, room, !!debugWorker);
      break;
    case "admin.start":
      logger("admin.start");
      postMessage({ type: "admin.start.requested" });
      emitWithAck("admin.start", {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.start.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.start.error", body: (err && err.message) ? err.message : String(err) }));
      break;
    case "admin.end":
      logger("admin.end");
      postMessage({ type: "admin.end.requested" });
      emitWithAck("admin.end", {}, { tries: 3, timeout: 1000, jitter: 0.2 })
        .then((res) => postMessage({ type: "admin.end.confirmed", body: res }))
        .catch((err) => postMessage({ type: "admin.end.error", body: (err && err.message) ? err.message : String(err) }));
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
