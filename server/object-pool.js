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

    // Preallocate
    for (let i = 0; i < this.initialSize; i++) {
      const obj = this._create();
      if (obj) this.pool.push(obj);
    }
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
    return obj;
  }

  // Return an object to the pool
  returnObject(obj) {
    if (!obj) return;

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
  }

  reset() {
    this.pool.length = 0;
    this.createdCount = 0;
    this._inUse.clear();
    for (let i = 0; i < this.initialSize; i++) {
      const obj = this._create();
      if (obj) this.pool.push(obj);
    }
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
