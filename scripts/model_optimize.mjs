import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(repoRoot, "web", "static", "assets");
const outDir = path.join(repoRoot, "output", "model-optimize");

function listAssets(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) continue;
    files.push(full);
  }
  return files;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)}MB`;
}

function main() {
  if (!fs.existsSync(assetsDir)) {
    console.error("assets directory not found:", assetsDir);
    process.exit(1);
  }

  const assets = listAssets(assetsDir)
    .filter((p) => /\.(gltf|glb|png|jpe?g|webp)$/i.test(p))
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      const rel = path.relative(repoRoot, filePath);
      return {
        path: rel,
        sizeBytes: stat.size,
        size: formatBytes(stat.size),
        ext: path.extname(filePath).slice(1).toLowerCase(),
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  const report = {
    generatedAt: new Date().toISOString(),
    assets,
    recommendations: [
      "Use glTF mesh compression (meshopt) and prune unused nodes/materials.",
      "Convert heavy textures to WebP/AVIF and keep power-of-two sizes.",
      "Run Draco only for large static meshes to avoid decode spikes.",
      "Bake lightmaps for static props if lighting remains consistent.",
    ],
    pipelineExample: [
      "npx @gltf-transform/cli optimize web/static/assets/boat.gltf web/static/assets/boat.optimized.glb --texture-compress webp --meshopt",
      "npx @gltf-transform/cli optimize web/static/assets/turtle.gltf web/static/assets/turtle.optimized.glb --texture-compress webp --meshopt",
      "npx @gltf-transform/cli optimize web/static/assets/box.gltf web/static/assets/box.optimized.glb --texture-compress webp --meshopt",
    ],
  };

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Model optimization report written to ${path.relative(repoRoot, reportPath)}`);
  assets.forEach((a) => {
    console.log(`${a.path} - ${a.size}`);
  });
}

main();
