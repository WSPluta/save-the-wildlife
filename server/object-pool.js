// Object Pool Manager with capacity tracking and diagnostics
class ObjectPool {
  /**
   * @param {() => any} createFunc factory that returns a new object instance
   * @param {number} initialSize number of preallocated objects kept idle in the pool
   * @param {number} maxSize hard cap of total objects that can be created (in use + in pool)
   */
  constructor(createFunc, initialSize = 10, maxSize = 100) {
    this.createFunc = createFunc;
    this.initialSize = Math.max(0, initialSize | 0);
    this.maxSize = Math.max(this.initialSize, maxSize | 0);

    // Idle objects ready to hand out
    this.pool = [];
    // Number of ever-created objects still in circulation (idle + in-use)
    this.createdCount = 0;
    // Optional: track IDs or object refs that are currently in-use for debugging
    this._inUse = new Set();
    // Basic logger toggle
    this._debug = false;

    // Performance monitoring
    this._recycleCount = 0;
    this._recycleTimes = []; // Sample recycle durations
    this._lastResizeAt = Date.now();

    // Preallocate
    this.resize(this.initialSize, this.maxSize);
  }

  setDebug(enabled) {
    this._debug = !!enabled;
  }

  _log(...args) {
    if (this._debug) {
      // eslint-disable-next-line no-console
      console.log("[ObjectPool]", ...args);
    }
  }

  _create() {
    if (this.createdCount >= this.maxSize) {
      this._log("create() denied - maxSize reached", {
        createdCount: this.createdCount,
        maxSize: this.maxSize,
      });
      return null;
    }
    const obj = this.createFunc();
    this.createdCount++;
    return obj;
  }

  // Get an object from the pool or create if capacity remains
  getObject() {
    const start = performance.now();
    let obj = null;
    if (this.pool.length > 0) {
      obj = this.pool.pop();
    } else {
      obj = this._create();
      if (!obj) {
        // Exhausted
        return null;
      }
    }

    // Track in-use for diagnostics
    try {
      const key = this._keyFor(obj);
      this._inUse.add(key);
    } catch {
      /* ignore */
    }

    const duration = performance.now() - start;
    if (duration > 1) { // Log slow gets (>1ms)
      this._log("Slow getObject", { duration, poolSize: this.pool.length });
    }
    return obj;
  }

  // Return an object to the pool
  returnObject(obj) {
    if (!obj) return;

    const start = performance.now();

    // Remove from in-use diagnostics
    try {
      const key = this._keyFor(obj);
      this._inUse.delete(key);
    } catch {
      /* ignore */
    }

    // If we've somehow already got more than max in pool, just drop it
    if (this.pool.length >= this.maxSize) {
      // Do not increment createdCount; it's a lifetime counter for created objects
      return;
    }
    this.pool.push(obj);

    this._recycleCount++;
    const duration = performance.now() - start;
    if (this._recycleTimes.length < 100) { // Keep recent samples
      this._recycleTimes.push(duration);
    } else {
      this._recycleTimes.shift();
      this._recycleTimes.push(duration);
    }

    if (duration > 1) { // Log slow returns (>1ms)
      this._log("Slow returnObject", { duration, poolSize: this.pool.length });
    }
  }

  resize(newInitialSize, newMaxSize) {
    const now = Date.now();
    newInitialSize = Math.max(0, newInitialSize | 0);
    newMaxSize = Math.max(newInitialSize, newMaxSize | 0);

    if (newMaxSize < this.maxSize) {
      // Shrink: Trim excess from pool
      while (this.pool.length > newInitialSize) {
        this.pool.pop();
      }
      // Note: Cannot shrink createdCount; objects in-use remain until returned
      this._log("Pool shrunk", { oldMax: this.maxSize, newMax: newMaxSize, oldInitial: this.initialSize, newInitial: newInitialSize });
    } else if (newInitialSize > this.initialSize || newMaxSize > this.maxSize) {
      // Grow: Preallocate up to newInitialSize if capacity allows
      const toAdd = Math.min(newInitialSize - this.pool.length, newMaxSize - this.createdCount);
      for (let i = 0; i < toAdd; i++) {
        const obj = this._create();
        if (obj) this.pool.push(obj);
      }
      this._log("Pool grown", { oldMax: this.maxSize, newMax: newMaxSize, oldInitial: this.initialSize, newInitial: newInitialSize, added: toAdd });
    }

    this.initialSize = newInitialSize;
    this.maxSize = newMaxSize;
    this._lastResizeAt = now;
  }

  reset() {
    this.pool.length = 0;
    this.createdCount = 0;
    this._inUse.clear();
    this._recycleCount = 0;
    this._recycleTimes = [];
    this.resize(this.initialSize, this.maxSize);
  }

  // Helpers / diagnostics
  size() {
    return this.pool.length;
  }

  capacity() {
    return this.maxSize;
  }

  inUseCount() {
    return Math.max(0, this.createdCount - this.pool.length);
  }

  isExhausted() {
    return this.createdCount >= this.maxSize && this.pool.length === 0;
  }

  getMetrics() {
    const avgRecycleTime = this._recycleTimes.length > 0 ? this._recycleTimes.reduce((a, b) => a + b, 0) / this._recycleTimes.length : 0;
    return {
      poolSize: this.size(),
      inUse: this.inUseCount(),
      totalCreated: this.createdCount,
      maxSize: this.maxSize,
      recycleCount: this._recycleCount,
      avgRecycleTime: avgRecycleTime.toFixed(3),
      lastResize: Date.now() - this._lastResizeAt,
      exhausted: this.isExhausted(),
    };
  }

  _keyFor(obj) {
    // Prefer id if present; else fallback to object identity
    if (obj && typeof obj === "object" && "id" in obj) return `id:${obj.id}`;
    return `ref:${ObjectPool._refId(obj)}`;
  }

  static _refId(obj) {
    if (!this.__weakIds) this.__weakIds = new WeakMap();
    if (!this.__nextId) this.__nextId = 1;
    let id = this.__weakIds.get(obj);
    if (!id) {
      id = this.__nextId++;
      this.__weakIds.set(obj, id);
    }
    return id;
  }
}

export default ObjectPool;
