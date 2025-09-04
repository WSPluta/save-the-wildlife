/**
 * Shared game logic utilities extracted for unit testing.
 * These functions mirror the logic used in server/server.js.
 */

/**
 * Clamp number between lo and hi
 */
export const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Iterative Fibonacci (non-recursive), returns F(n) with F(0)=0, F(1)=1
 */
export function fib(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Normalize a room identifier:
 * - Trim/uppercase
 * - Keep only A-Z 0-9 - _
 * - Max length 24
 * - Return null if empty after normalization
 */
export function normalizeRoom(r) {
  if (!r) return null;
  const s = String(r).trim().toUpperCase();
  if (!s) return null;
  const cleaned = s.replace(/[^A-Z0-9\-_]/g, "").slice(0, 24);
  return cleaned || null;
}

/**
 * Compute target item counts given players and spawn mode.
 * Params:
 *  - mode: "fibonacci" | "proportional"
 *  - params: {
 *      k, tr, mr, pr,                     // proportional factors
 *      fibTTrash, fibTMarine, fibTPU,     // fibonacci offsets
 *      clampTrash, clampMarine, clampPU   // clamps
 *    }
 *  - humans: number of human players
 */
export function computeTargets(mode, params, humans) {
  const p = Math.max(0, parseInt(humans || 0));
  let targetTrash = 0, targetMarine = 0, targetPU = 0;

  if (mode === "fibonacci") {
    const baseAdd = 1;
    const tTrash = fib(p + (params?.fibTTrash ?? 0));
    const tMarine = fib(p + (params?.fibTMarine ?? 0));
    const tPU = fib(Math.max(0, p + (params?.fibTPU ?? 0)));
    targetTrash = baseAdd + tTrash;
    targetMarine = baseAdd + tMarine;
    // Power-ups: mild growth bounded by p
    targetPU = baseAdd + Math.min(p, tPU);
  } else {
    const k = params?.k ?? 1;
    const tr = params?.tr ?? 1;   // trash ratio
    const mr = params?.mr ?? 2;   // marine ratio
    const pr = params?.pr ?? 0.2; // powerup ratio
    targetTrash = Math.ceil(k * p * tr);
    targetMarine = Math.ceil(k * p * mr);
    targetPU = Math.ceil(k * p * pr);
  }

  const clampT = params?.clampTrash ?? 500;
  const clampM = params?.clampMarine ?? 1000;
  const clampP = params?.clampPU ?? 50;

  return {
    trash: clampNum(targetTrash, 0, clampT),
    marine: clampNum(targetMarine, 0, clampM),
    powerups: clampNum(targetPU, 0, clampP),
  };
}

/**
 * World scaling:
 * Given current humans and a scaling config, return { x, z } world size.
 * scale = sqrt(players/basePlayers), clamped to min/max bounds.
 */
export function recomputeWorldSize(humans, worldScaleCfg) {
  const p = Math.max(1, parseInt(humans || 1));
  const basePlayers = Math.max(1, parseInt(worldScaleCfg?.basePlayers ?? 4));
  const baseX = parseInt(worldScaleCfg?.baseX ?? 88);
  const baseZ = parseInt(worldScaleCfg?.baseZ ?? 22);
  const minX = parseInt(worldScaleCfg?.minX ?? Math.round(baseX * 0.5));
  const minZ = parseInt(worldScaleCfg?.minZ ?? Math.round(baseZ * 0.5));
  const maxX = parseInt(worldScaleCfg?.maxX ?? Math.round(baseX * 2));
  const maxZ = parseInt(worldScaleCfg?.maxZ ?? Math.round(baseZ * 4));

  const scale = Math.sqrt(p / basePlayers);
  const x = clampNum(Math.round(baseX * scale), minX, maxX);
  const z = clampNum(Math.round(baseZ * scale), minZ, maxZ);
  return { x, z };
}
