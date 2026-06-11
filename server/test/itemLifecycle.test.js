import { describe, expect, it } from "vitest";
import ObjectPool from "../object-pool.js";
import { reinitializeItemForSpawn, snapshotItemForEvent } from "../lib/itemLifecycle.js";

describe("item lifecycle respawn", () => {
  it("assigns a fresh public id each time a pooled object respawns", () => {
    let nextId = 0;
    const pool = new ObjectPool(() => ({ id: "preallocated" }), 1, 1);
    const ids = new Set();

    for (let i = 0; i < 200; i++) {
      const obj = pool.getObject();
      expect(obj).toBeTruthy();
      reinitializeItemForSpawn(obj, "trash", {
        idFactory: () => `item-${++nextId}`,
        coordinateFactory: () => 0,
        itemMinSize: 0.5,
        itemMaxSize: 0.5,
        random: () => 0,
      });
      expect(ids.has(obj.id)).toBe(false);
      ids.add(obj.id);
      pool.returnObject(obj);
    }

    expect(ids.size).toBe(200);
    expect(pool.getMetrics().exhausted).toBe(false);
  });

  it("keeps pool diagnostics clean when game ids mutate", () => {
    const pool = new ObjectPool(() => ({ id: "initial" }), 1, 1);
    const obj = pool.getObject();
    obj.id = "spawn-1";
    pool.returnObject(obj);

    expect(pool._inUse.size).toBe(0);

    const same = pool.getObject();
    expect(same).toBe(obj);
    same.id = "spawn-2";
    pool.returnObject(same);

    expect(pool._inUse.size).toBe(0);
  });

  it("snapshots event coordinates before the object is recycled", () => {
    const obj = { id: "trash-1", type: "trash", room: "ROOM-1", size: "0.50", position: { x: 3, y: 0, z: -2 } };
    const snapshot = snapshotItemForEvent(obj);

    reinitializeItemForSpawn(obj, "trash", {
      idFactory: () => "trash-2",
      coordinateFactory: () => 9,
      itemMinSize: 0.5,
      itemMaxSize: 0.5,
      random: () => 0,
    });

    expect(snapshot).toMatchObject({
      id: "trash-1",
      type: "trash",
      room: "ROOM-1",
      position: { x: 3, y: 0, z: -2 },
    });
    expect(obj.id).toBe("trash-2");
    expect(obj.position).toEqual({ x: 9, y: 0, z: 9 });
  });
});
