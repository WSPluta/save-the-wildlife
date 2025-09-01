import * as THREE from "three";

/**
 * Gerstner-wave water surface that actually displaces geometry in the vertex shader.
 * - Uses MeshStandardMaterial for PBR lighting and environment reflections.
 * - Injects custom vertex code via onBeforeCompile to keep Three.js material features.
 * - Uniforms:
 *    - time: advancing time in seconds
 *    - waveDir[i] (vec2), waveAmp[i], waveLen[i], waveSpd[i]
 *
 * Keep NUM_WAVES in sync with buoyancy.js WAVES to ensure visuals match buoyancy.
 */

const NUM_WAVES = 3;

// Default wave params (match buoyancy.js)
const DEFAULT_WAVES = {
  dir: [
    new THREE.Vector2(1.0, 0.4).normalize(),
    new THREE.Vector2(-0.8, 1.0).normalize(),
    new THREE.Vector2(0.2, -1.0).normalize(),
  ],
  // Calmer sea to improve playability; match buoyancy.js
  amp: [0.02, 0.015, 0.01],
  len: [14.0, 8.0, 4.5],
  spd: [0.5, 0.8, 1.1],
};

export function createGerstnerWater(size = 10000, segments = 256, waterNormals = null, waves = DEFAULT_WAVES) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);

  // MeshPhysicalMaterial for more convincing water (PBR + transmission + clearcoat)
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x1b6c8b), // brighter blue-green
    metalness: 0.0,
    roughness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.25,
    transmission: 0.55,
    ior: 1.333,
    thickness: 0.2,
    side: THREE.DoubleSide,
  });
  material.envMapIntensity = 1.2;

  if (waterNormals) {
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
    waterNormals.repeat.set(4, 4);
    material.normalMap = waterNormals;
    material.normalScale = new THREE.Vector2(0.4, 0.4);
    // We'll animate normalMap.offset in the render loop
  }

  // Expose uniforms on the material to remain compatible with existing code:
  // script.js updates water.material.uniforms["time"].value = waterTimeSec;
  material.uniforms = {
    time: { value: 0 },
    waveDir: { value: waves.dir },
    waveAmp: { value: waves.amp },
    waveLen: { value: waves.len },
    waveSpd: { value: waves.spd },
  };

  material.onBeforeCompile = (shader) => {
    // Bridge material.uniforms -> shader uniforms
    shader.uniforms.time = material.uniforms.time;
    shader.uniforms.waveDir = { value: material.uniforms.waveDir.value };
    shader.uniforms.waveAmp = { value: material.uniforms.waveAmp.value };
    shader.uniforms.waveLen = { value: material.uniforms.waveLen.value };
    shader.uniforms.waveSpd = { value: material.uniforms.waveSpd.value };

    shader.defines.NUM_WAVES = NUM_WAVES;

    // Common helpers and uniforms
    const injectCommon = `
      #include <common>
      uniform float time;
      uniform vec2 waveDir[NUM_WAVES];
      uniform float waveAmp[NUM_WAVES];
      uniform float waveLen[NUM_WAVES];
      uniform float waveSpd[NUM_WAVES];

      // Computes Gerstner wave height and derivatives at XY-plane position p=(x,y)
      void gerstner(in vec2 p, out float height, out vec2 dHdXY) {
        const float G = 9.81;
        const float TWO_PI = 6.28318530718;
        height = 0.0;
        dHdXY = vec2(0.0, 0.0);
        for (int i = 0; i < NUM_WAVES; i++) {
          float k = TWO_PI / waveLen[i];
          float w = sqrt(G * k) * waveSpd[i];
          float phase = k * dot(waveDir[i], p) - w * time;
          float s = sin(phase);
          float c = cos(phase);
          height += waveAmp[i] * s;
          // derivatives wrt x and y (plane lies on XY, up is +Z before rotation)
          dHdXY += waveAmp[i] * c * k * waveDir[i];
        }
      }
    `;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      injectCommon
    );

    // Compute objectNormal using analytical gradient. Before rotation, up is Z.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `
        // Compute gradient at current vertex XY
        float h_dummy;
        vec2 dHdXY;
        gerstner(position.xy, h_dummy, dHdXY);
        // Normal from gradient (n = normalize(-dH/dx, -dH/dy, 1))
        vec3 objectNormal = normalize(vec3(-dHdXY.x, -dHdXY.y, 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif
      `
    );

    // Displace vertex along Z to represent height (plane will be rotated -PI/2 in world)
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
        float heightValue;
        vec2 dHdXY2;
        gerstner(position.xy, heightValue, dHdXY2);
        vec3 transformed = vec3(position.x, position.y, position.z + heightValue);
        #ifdef USE_ALPHAHASH
          vPosition = vec3(position);
        #endif
      `
    );

    material.userData.shader = shader;
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
