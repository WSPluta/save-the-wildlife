import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { register, updateRuntimeMetrics } from "../metrics.js";

const serverSource = readFileSync("server.js", "utf8");

describe("observability metrics", () => {
  it("exports user, socket, and room gauges for Prometheus", async () => {
    updateRuntimeMetrics({
      players: { total: 7, humans: 5, bots: 2 },
      sockets: { connections: 8 },
      rooms: { active: 3, waiting: 1, starting: 0, running: 2, ended: 0 },
      items: { trash: 12, marine: 4, powerups: 1 },
      targets: { trash: 20, marine: 8, powerups: 2 },
      world: { x: 88, z: 22 },
      tps: 60,
      hz: 20,
    }, "RUNNING");

    const metrics = await register.metrics();
    expect(metrics).toContain("stwl_players_total 7");
    expect(metrics).toContain("stwl_socket_connections 8");
    expect(metrics).toContain("stwl_rooms_active 3");
    expect(metrics).toContain("stwl_rooms_running 2");
    expect(metrics).toContain("stwl_game_state 2");
  });

  it("keeps Prometheus global while broadcasting room-scoped UI metrics", () => {
    expect(serverSource).toMatch(/globalMetrics\.scope = "global"/);
    expect(serverSource).toMatch(/updateRuntimeMetrics\(globalMetrics, gameState\)/);
    expect(serverSource).toMatch(/const rooms = Array\.from\(new Set\(\[DEFAULT_ROOM_ID, \.\.\.listActiveRooms\(\)\]\)\)/);
    expect(serverSource).toMatch(/const roomCounts = await countItemsForRoom\(room\)/);
    expect(serverSource).toMatch(/roomMetrics\.scope = "room"/);
    expect(serverSource).toMatch(/roomMetrics\.global = \{/);
    expect(serverSource).toMatch(/io\.to\(room\)\.volatile\.compress\(true\)\.emit\("server\.metrics", roomMetrics\)/);
  });
});
