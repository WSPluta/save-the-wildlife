#!/usr/bin/env zx
import { getNpmVersion } from "./lib/npm.mjs";
import { getNamespace, getRegionByName } from "./lib/oci.mjs";
import { checkPodmanMachineRunning, buildImage, containerLogin, tagImage, pushImage } from "./lib/container.mjs";
import { getVersionGradle } from "./lib/gradle.mjs";

$.verbose = false;

checkPodmanMachineRunning();

const namespaceEnv = process.env.NAMESPACE || process.env.namespace;
const namespace = namespaceEnv || (await getNamespace());
const ociRegionNameFromEnv = (await $`echo $OCI_REGION`).stdout.trim();
const regionKeyEnv = process.env.REGION_KEY || process.env.region_key;
let regionKey = regionKeyEnv;
if (!regionKey) {
  const region = await getRegionByName(ociRegionNameFromEnv);
  regionKey = region["region-key"].toLowerCase();
}
console.log({ namespace, regionKey });

// Registry setup (OCIR)
const project = "save-the-wildlife";
const ocirUrl = `${regionKey}.ocir.io`;
const ocirUser = process.env.OCIR_USER || process.env.OCIR_USERNAME;
const ocirToken = process.env.OCIR_TOKEN || process.env.OCIR_AUTH_TOKEN;
let ocirLoginDone = false;
if (ocirUser && ocirToken) {
  try {
    await containerLogin(namespace, ocirUser, ocirToken, ocirUrl);
    ocirLoginDone = true;
  } catch (e) {
    console.log("OCIR login failed; builds will complete but push will be skipped.");
  }
} else {
  console.log("OCIR_USER/OCIR_TOKEN not set; skipping push to registry.");
}

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

if (a || action === "all") {
  await releaseNpm("server");
  await releaseNpm("web");
  await releaseGradle("score");
  await releaseGradle("replay");
  process.exit(0);
}

console.log("Usage:");
console.log("\tnpx zx scripts/build.mjs all");
console.log("\tnpx zx scripts/build.mjs -a");
console.log("\tnpx zx scripts/build.mjs ws-server");
console.log("\tnpx zx scripts/build.mjs web");
console.log("\tnpx zx scripts/build.mjs score");

async function releaseNpm(service) {
  await cd(`${service}`);
  const currentVersion = await getNpmVersion();
  console.log(`Releasing ${service}:${currentVersion})`);
  await buildImage(`${service}`, currentVersion);
  await cd("..");

  // Tag and push to OCIR if logged in
  const localImage = `${service}:${currentVersion}`;
  const remoteImage = `${ocirUrl}/${namespace}/${project}/${service}:${currentVersion}`;
  if (ocirLoginDone) {
    await tagImage(localImage, remoteImage);
    await pushImage(remoteImage);
    console.log(`Pushed: ${chalk.yellow(remoteImage)}`);
  } else {
    console.log(`Built: ${chalk.yellow(localImage)}. Skipped push. Set OCIR_USER/OCIR_TOKEN to push ${remoteImage}`);
  }
}

async function releaseGradle(service) {
  await cd(`${service}`);
  const currentVersion = await getVersionGradle();
  console.log(`Releasing ${service}:${currentVersion})`);
  await buildImage(`${service}`, currentVersion);
  await cd("..");

  // Tag and push to OCIR if logged in
  const localImage = `${service}:${currentVersion}`;
  const remoteImage = `${ocirUrl}/${namespace}/${project}/${service}:${currentVersion}`;
  if (ocirLoginDone) {
    await tagImage(localImage, remoteImage);
    await pushImage(remoteImage);
    console.log(`Pushed: ${chalk.yellow(remoteImage)}`);
  } else {
    console.log(`Built: ${chalk.yellow(localImage)}. Skipped push. Set OCIR_USER/OCIR_TOKEN to push ${remoteImage}`);
  }
}
