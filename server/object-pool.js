// Object Pool Manager
class ObjectPool {
  constructor(createFunc, initialSize = 10, maxSize = 100) {
    this.createFunc = createFunc;
    this.initialSize = initialSize;
    this.maxSize = maxSize;
    this.pool = [];

    // Initialize the pool with initialSize objects
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(createFunc());
    }
  }

  // Get an object from the pool
  getObject() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    } else if (this.pool.length === 0 && this.maxSize > this.initialSize) {
      // If pool is empty and we haven't reached maxSize, create a new object
      return this.createFunc();
    } else {
      // If pool is empty and we've reached maxSize, return null or throw an error
      return null;
    }
  }

  // Return an object to the pool
  returnObject(obj) {
    if (this.pool.length < this.maxSize) {
      this.pool.push(obj);
    }
  }

  // Reset the pool
  reset() {
    this.pool.length = 0;
    for (let i = 0; i < this.initialSize; i++) {
      this.pool.push(this.createFunc());
    }
  }
}

export default ObjectPool;
