import client from "prom-client";

const register = new client.Registry();

// Default process metrics with a prefix
client.collectDefaultMetrics({ register, prefix: "stwl_" });

// Gauges
const gPlayersTotal = new client.Gauge({
  name: "stwl_players_total",
  help: "Total connected players (humans + bots)",
  registers: [register],
});
const gPlayersHumans = new client.Gauge({
  name: "stwl_players_humans",
  help: "Connected human players",
  registers: [register],
});
const gPlayersBots = new client.Gauge({
  name: "stwl_players_bots",
  help: "Connected bot players",
  registers: [register],
});
const gSocketConnections = new client.Gauge({
  name: "stwl_socket_connections",
  help: "Open Socket.IO connections",
  registers: [register],
});
const gRoomsActive = new client.Gauge({
  name: "stwl_rooms_active",
  help: "Active rooms visible to operators",
  registers: [register],
});
const gRoomsWaiting = new client.Gauge({
  name: "stwl_rooms_waiting",
  help: "Rooms in WAITING state",
  registers: [register],
});
const gRoomsStarting = new client.Gauge({
  name: "stwl_rooms_starting",
  help: "Rooms in STARTING state",
  registers: [register],
});
const gRoomsRunning = new client.Gauge({
  name: "stwl_rooms_running",
  help: "Rooms in RUNNING state",
  registers: [register],
});
const gRoomsEnded = new client.Gauge({
  name: "stwl_rooms_ended",
  help: "Rooms in ENDED state",
  registers: [register],
});

const gWorldX = new client.Gauge({
  name: "stwl_world_x",
  help: "World size X",
  registers: [register],
});
const gWorldZ = new client.Gauge({
  name: "stwl_world_z",
  help: "World size Z",
  registers: [register],
});

const gItemsTrash = new client.Gauge({
  name: "stwl_items_trash",
  help: "Number of trash items",
  registers: [register],
});
const gItemsMarine = new client.Gauge({
  name: "stwl_items_marine",
  help: "Number of marine life items",
  registers: [register],
});
const gItemsPower = new client.Gauge({
  name: "stwl_items_powerups",
  help: "Number of power-up items",
  registers: [register],
});

const gTargetsTrash = new client.Gauge({
  name: "stwl_targets_trash",
  help: "Target number of trash items (spawn controller)",
  registers: [register],
});
const gTargetsMarine = new client.Gauge({
  name: "stwl_targets_marine",
  help: "Target number of marine life items (spawn controller)",
  registers: [register],
});
const gTargetsPower = new client.Gauge({
  name: "stwl_targets_powerups",
  help: "Target number of power-ups (spawn controller)",
  registers: [register],
});

const gTps = new client.Gauge({
  name: "stwl_server_tps",
  help: "Server simulation ticks per second (config)",
  registers: [register],
});
const gHz = new client.Gauge({
  name: "stwl_state_broadcast_hz",
  help: "Authoritative state broadcast frequency (config)",
  registers: [register],
});

// Game state enum gauge: 0=WAITING, 1=STARTING, 2=RUNNING, 3=ENDED
const gGameState = new client.Gauge({
  name: "stwl_game_state",
  help: "Game state (0=WAITING,1=STARTING,2=RUNNING,3=ENDED)",
  registers: [register],
});

const STATE_MAP = { WAITING: 0, STARTING: 1, RUNNING: 2, ENDED: 3 };

export function setGameState(stateName) {
  try {
    const v = STATE_MAP[String(stateName || "").toUpperCase()];
    if (typeof v === "number") gGameState.set(v);
  } catch (_) {}
}

/**
 * Update runtime gauges from the server.metrics payload (from buildMetricsObject)
 * m example:
 * {
 *   players: { total, humans, bots },
 *   world: { x, z },
 *   items: { trash, marine, powerups },
 *   targets: { trash, marine, powerups },
 *   spawn: { mode, params, nextTickMs },
 *   serverAuthEnabled: boolean,
 *   tps: number,
 *   hz: number
 * }
 */
export function updateRuntimeMetrics(m, stateName) {
  try {
    if (!m || typeof m !== "object") return;
    if (m.players) {
      if (Number.isFinite(m.players.total)) gPlayersTotal.set(m.players.total);
      if (Number.isFinite(m.players.humans)) gPlayersHumans.set(m.players.humans);
      if (Number.isFinite(m.players.bots)) gPlayersBots.set(m.players.bots);
    }
    if (m.sockets && Number.isFinite(m.sockets.connections)) {
      gSocketConnections.set(m.sockets.connections);
    }
    if (m.rooms) {
      if (Number.isFinite(m.rooms.active)) gRoomsActive.set(m.rooms.active);
      if (Number.isFinite(m.rooms.waiting)) gRoomsWaiting.set(m.rooms.waiting);
      if (Number.isFinite(m.rooms.starting)) gRoomsStarting.set(m.rooms.starting);
      if (Number.isFinite(m.rooms.running)) gRoomsRunning.set(m.rooms.running);
      if (Number.isFinite(m.rooms.ended)) gRoomsEnded.set(m.rooms.ended);
    }
    if (m.world) {
      if (Number.isFinite(m.world.x)) gWorldX.set(m.world.x);
      if (Number.isFinite(m.world.z)) gWorldZ.set(m.world.z);
    }
    if (m.items) {
      if (Number.isFinite(m.items.trash)) gItemsTrash.set(m.items.trash);
      if (Number.isFinite(m.items.marine)) gItemsMarine.set(m.items.marine);
      if (Number.isFinite(m.items.powerups)) gItemsPower.set(m.items.powerups);
    }
    if (m.targets) {
      if (Number.isFinite(m.targets.trash)) gTargetsTrash.set(m.targets.trash);
      if (Number.isFinite(m.targets.marine)) gTargetsMarine.set(m.targets.marine);
      if (Number.isFinite(m.targets.powerups)) gTargetsPower.set(m.targets.powerups);
    }
    if (Number.isFinite(m.tps)) gTps.set(m.tps);
    if (Number.isFinite(m.hz)) gHz.set(m.hz);
    if (stateName) setGameState(stateName);
  } catch (_) {}
}

export { register };
