export class ObjectPool {
  constructor({
    name = "pool",
    create,
    reset = null,
    initialSize = 0,
    maxSize = 100,
    objectSizeBytes = 0,
  }) {
    if (typeof create !== "function") {
      throw new Error("ObjectPool requires a create() function");
    }
    this.name = name;
    this.create = create;
    this.reset = typeof reset === "function" ? reset : () => {};
    this.objectSizeBytes = Math.max(0, Number(objectSizeBytes) || 0);
    this.maxSize = Math.max(1, Number(maxSize) || 1);
    this.initialSize = Math.max(0, Math.min(this.maxSize, Number(initialSize) || 0));

    this.free = [];
    this.inUse = new Set();
    this.meta = new WeakMap();
    this.stats = {
      name: this.name,
      created: 0,
      acquired: 0,
      released: 0,
      errors: 0,
      totalAcquireMs: 0,
      totalReleaseMs: 0,
      totalLifetimeMs: 0,
      peakInUse: 0,
    };

    for (let i = 0; i < this.initialSize; i++) {
      this.free.push(this._createOne());
    }
  }

  _createOne() {
    const obj = this.create();
    const now = performance.now();
    this.stats.created++;
    this.meta.set(obj, { createdAt: now, acquiredAt: 0, releasedAt: now });
    return obj;
  }

  resize(nextInitial, nextMax = this.maxSize) {
    const normalizedMax = Math.max(1, Number(nextMax) || 1);
    const normalizedInitial = Math.max(0, Math.min(normalizedMax, Number(nextInitial) || 0));
    this.maxSize = normalizedMax;
    this.initialSize = normalizedInitial;
    while (this.free.length > this.initialSize) {
      this.free.pop();
    }
    while (this.free.length < this.initialSize && this.totalCount() < this.maxSize) {
      this.free.push(this._createOne());
    }
  }

  totalCount() {
    return this.free.length + this.inUse.size;
  }

  acquire() {
    const t0 = performance.now();
    try {
      let obj = this.free.pop();
      if (!obj) {
        if (this.totalCount() < this.maxSize) {
          obj = this._createOne();
        } else {
          this.stats.errors++;
          return null;
        }
      }
      this.inUse.add(obj);
      this.stats.acquired++;
      this.stats.peakInUse = Math.max(this.stats.peakInUse, this.inUse.size);
      const m = this.meta.get(obj);
      if (m) m.acquiredAt = performance.now();
      this.stats.totalAcquireMs += performance.now() - t0;
      return obj;
    } catch (_) {
      this.stats.errors++;
      this.stats.totalAcquireMs += performance.now() - t0;
      return null;
    }
  }

  release(obj) {
    if (!obj) return;
    const t0 = performance.now();
    try {
      if (!this.inUse.has(obj)) {
        this.stats.errors++;
        return;
      }
      this.inUse.delete(obj);
      try {
        this.reset(obj);
      } catch (_) {
        this.stats.errors++;
      }
      const m = this.meta.get(obj);
      if (m) {
        const now = performance.now();
        if (m.acquiredAt > 0) this.stats.totalLifetimeMs += Math.max(0, now - m.acquiredAt);
        m.releasedAt = now;
        m.acquiredAt = 0;
      }
      this.free.push(obj);
      this.stats.released++;
    } finally {
      this.stats.totalReleaseMs += performance.now() - t0;
    }
  }

  metrics() {
    const avgAcquireMs = this.stats.acquired
      ? this.stats.totalAcquireMs / this.stats.acquired
      : 0;
    const avgReleaseMs = this.stats.released
      ? this.stats.totalReleaseMs / this.stats.released
      : 0;
    const avgLifetimeMs = this.stats.released
      ? this.stats.totalLifetimeMs / this.stats.released
      : 0;
    return {
      name: this.name,
      inUse: this.inUse.size,
      free: this.free.length,
      total: this.totalCount(),
      max: this.maxSize,
      peakInUse: this.stats.peakInUse,
      errors: this.stats.errors,
      avgAcquireMs: Number(avgAcquireMs.toFixed(3)),
      avgReleaseMs: Number(avgReleaseMs.toFixed(3)),
      avgLifetimeMs: Number(avgLifetimeMs.toFixed(1)),
      memoryEstimateBytes: this.objectSizeBytes * this.totalCount(),
    };
  }
}

