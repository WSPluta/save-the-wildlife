import { io } from "socket.io-client";

let socket;

function init(wsURL, yourId, yourName) {
  logger(`WebWorker commsWorker start on ${wsURL}`);
  socket = io(wsURL, { 
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000
  });

  // Socket.IO Manager-level diagnostics (connection lifecycle)
  socket.io.on("reconnect_attempt", (attempt) => logger(`reconnect_attempt #${attempt}`));
  socket.io.on("reconnect_error", (error) => postMessage({ type: "error", body: `reconnect_error: ${error && error.message ? error.message : error}` }));
  socket.io.on("reconnect_failed", () => logger("reconnect_failed"));
  socket.io.on("open", () => logger("manager open"));
  socket.io.on("close", (reason) => logger(`manager close: ${reason}`));
  socket.io.on("error", (error) => postMessage({ type: "error", body: `manager error: ${error && error.message ? error.message : error}` }));

  logger(`I am ${yourName} with id ${yourId} joining the game`);
  socket.emit("player.info.joining", { id: yourId, name: yourName });

  socket.io.on("error", (error) => postMessage({ error }));

  socket.on("connect_error", (error) => postMessage({ error }));

  socket.on("connect", () => {
    logger("connect");
    postMessage({ type: "connect" });
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

  // New: synchronized pre-start countdown and player counts
  socket.on("startingGame", (data) => {
    postMessage({ type: "startingGame", body: data });
  });

  socket.on("player.count", (data) => {
    postMessage({ type: "player.count", body: data });
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
    case "chat.send":
      // data.body: { text }
      socket.emit("chat.send", data.body);
      break;
    case "player.info.joining":
      // allow updating name while in lobby
      socket.emit("player.info.joining", data.body);
      break;
    case "init":
      const { wsURL, yourId, yourName } = data.body;
      init(wsURL, yourId, yourName);
      break;
    case "admin.start":
      logger("admin.start");
      socket.emit("admin.start");
      break;
    case "admin.end":
      logger("admin.end");
      socket.emit("admin.end");
      break;
    default:
      break;
  }
};

function logger(message) {
  const ts = new Date().toISOString();
  postMessage({
    type: "log",
    body: `[${ts}] Comms Worker: ${typeof message === "string" ? message : JSON.stringify(message)}`,
  });
}
