import * as THREE from "three";

class Node {
  constructor(box, depth, maxDepth, capacity) {
    this.box = box.clone();
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.capacity = capacity;
    this.children = null;
    this.entries = [];
  }

  subdivide() {
    if (this.children) return;
    const min = this.box.min;
    const max = this.box.max;
    const mid = new THREE.Vector3(
      (min.x + max.x) * 0.5,
      (min.y + max.y) * 0.5,
      (min.z + max.z) * 0.5
    );
    this.children = [];
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dz = 0; dz < 2; dz++) {
          const cmin = new THREE.Vector3(
            dx === 0 ? min.x : mid.x,
            dy === 0 ? min.y : mid.y,
            dz === 0 ? min.z : mid.z
          );
          const cmax = new THREE.Vector3(
            dx === 0 ? mid.x : max.x,
            dy === 0 ? mid.y : max.y,
            dz === 0 ? mid.z : max.z
          );
          this.children.push(
            new Node(new THREE.Box3(cmin, cmax), this.depth + 1, this.maxDepth, this.capacity)
          );
        }
      }
    }
  }

  insert(entry) {
    if (!this.box.intersectsBox(entry.box)) return false;
    if (!this.children && (this.entries.length < this.capacity || this.depth >= this.maxDepth)) {
      this.entries.push(entry);
      return true;
    }
    if (!this.children) this.subdivide();
    for (const child of this.children) {
      if (child.box.containsBox(entry.box)) {
        return child.insert(entry);
      }
    }
    this.entries.push(entry);
    return true;
  }

  queryFrustum(frustum, out) {
    if (!frustum.intersectsBox(this.box)) return;
    for (const e of this.entries) {
      if (frustum.intersectsBox(e.box)) out.push(e.value);
    }
    if (!this.children) return;
    for (const child of this.children) child.queryFrustum(frustum, out);
  }

  clear() {
    this.entries.length = 0;
    if (!this.children) return;
    for (const child of this.children) child.clear();
    this.children = null;
  }
}

export class SpatialOctree {
  constructor(box, opts = {}) {
    this.root = new Node(
      box,
      0,
      Math.max(1, Number(opts.maxDepth) || 5),
      Math.max(1, Number(opts.capacity) || 24)
    );
  }

  clear() {
    this.root.clear();
  }

  insertBox(box, value) {
    this.root.insert({ box: box.clone(), value });
  }

  queryFrustum(frustum) {
    const out = [];
    this.root.queryFrustum(frustum, out);
    return out;
  }
}

