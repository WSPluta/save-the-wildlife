#!/usr/bin/env zx
import { getNpmVersion } from "./lib/npm.mjs";
import { checkPodmanMachineRunning, buildImage } from "./lib/container.mjs";
import { getVersionGradle } from "./lib/gradle.mjs";

$.verbose = false;

checkPodmanMachineRunning();

const { a, _ } = argv;
const [action] = _;

if (action === "ws-server") {
  await releaseNpm("server");
  process.exit(0);
}

if (action === "web") {
  await releaseNpm("web");
  process.exit(0);
}

if (action === "score") {
  await releaseGradle("score");
  process.exit(0);
}

if (action === "replay") {
  await releaseGradle("replay");
  process.exit(0);
}

if (action === "private-agent-factory") {
  await releaseNpm("private-agent-factory", process.env.PAF_VERSION || "latest");
  process.exit(0);
}

if (action === "bots") {
  await releaseNpm("bots");
  process.exit(0);
}

if (action === "model-ai-training") {
  await releaseStaticImage("model-ai/training", "model-ai-training", process.env.MODEL_AI_TRAINING_VERSION || "latest");
  process.exit(0);
}

if (action === "model-ai-training-gpu") {
  await releaseStaticImage(
    "model-ai/training",
    "model-ai-training-gpu",
    process.env.MODEL_AI_TRAINING_GPU_VERSION || process.env.MODEL_AI_TRAINING_VERSION || "latest",
    { dockerfile: "Dockerfile.gpu" }
  );
  process.exit(0);
}

if (action === "model-ai-inference") {
  await releaseStaticImage("model-ai/inference", "model-ai-inference", process.env.MODEL_AI_INFERENCE_VERSION || "latest");
  process.exit(0);
}

if (a || action === "all") {
  await releaseNpm("server");
  await releaseNpm("web");
  await releaseGradle("score");
  await releaseGradle("replay");
  await releaseNpm("private-agent-factory", process.env.PAF_VERSION || "latest");
  await releaseNpm("bots");
  process.exit(0);
}

console.log("Usage:");
console.log("\tnpx zx scripts/build.mjs all");
console.log("\tnpx zx scripts/build.mjs -a");
console.log("\tnpx zx scripts/build.mjs ws-server");
console.log("\tnpx zx scripts/build.mjs web");
console.log("\tnpx zx scripts/build.mjs score");
console.log("\tnpx zx scripts/build.mjs replay");
console.log("\tnpx zx scripts/build.mjs private-agent-factory");
console.log("\tnpx zx scripts/build.mjs bots");
console.log("\tnpx zx scripts/build.mjs model-ai-training");
console.log("\tnpx zx scripts/build.mjs model-ai-training-gpu");
console.log("\tnpx zx scripts/build.mjs model-ai-inference");

async function releaseNpm(service, versionOverride) {
  await cd(`${service}`);
  const currentVersion = versionOverride || await getNpmVersion();
  console.log(`Releasing ${service}:${currentVersion})`);
  await buildImage(`${service}`, currentVersion);
  await cd("..");
}

async function releaseGradle(service) {
  await cd(`${service}`);
  const currentVersion = await getVersionGradle();
  console.log(`Releasing ${service}:${currentVersion})`);
  await buildImage(`${service}`, currentVersion);
  await cd("..");
}

async function releaseStaticImage(directory, imageName, version, options = {}) {
  await cd(directory);
  console.log(`Releasing ${imageName}:${version})`);
  await buildImage(imageName, version, options);
  await cd("../..");
}
