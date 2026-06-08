import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SpatialOctree } from "../spatialOctree";

describe("SpatialOctree", () => {
  it("returns only frustum-visible entries", () => {
    const world = new THREE.Box3(
      new THREE.Vector3(-100, -100, -100),
      new THREE.Vector3(100, 100, 100)
    );
    const tree = new SpatialOctree(world, { maxDepth: 4, capacity: 2 });
    tree.insertBox(
      new THREE.Box3(new THREE.Vector3(-2, -2, -8), new THREE.Vector3(2, 2, -4)),
      { id: "near" }
    );
    tree.insertBox(
      new THREE.Box3(new THREE.Vector3(50, 50, 50), new THREE.Vector3(60, 60, 60)),
      { id: "far" }
    );

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -10);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const frustum = new THREE.Frustum();
    const mat = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(mat);

    const vis = tree.queryFrustum(frustum).map((x) => x.id).sort();
    expect(vis).toEqual(["near"]);
  });
});

