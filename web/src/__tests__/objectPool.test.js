import { describe, it, expect } from "vitest";
import { ObjectPool } from "../objectPool";

describe("ObjectPool", () => {
  it("acquires/releases and tracks metrics", () => {
    let counter = 0;
    const pool = new ObjectPool({
      name: "test",
      initialSize: 2,
      maxSize: 3,
      create: () => ({ id: ++counter, active: false }),
      reset: (o) => { o.active = false; },
      objectSizeBytes: 100,
    });

    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    const d = pool.acquire();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(c).toBeTruthy();
    expect(d).toBeNull();

    a.active = true;
    pool.release(a);
    const m = pool.metrics();
    expect(m.total).toBe(3);
    expect(m.max).toBe(3);
    expect(m.inUse).toBe(2);
    expect(m.memoryEstimateBytes).toBe(300);
  });
});

