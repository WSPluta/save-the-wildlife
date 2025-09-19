#!/usr/bin/env zx
import { getNpmVersion } from "./lib/npm.mjs";
import { getNamespace, getRegionByName } from "./lib/oci.mjs";
import { checkPodmanMachineRunning, buildImage, containerLogin, tagImage, pushImage } from "./lib/container.mjs";
import { getVersionGradle } from "./lib/gradle.mjs";

$.verbose = false;

if (process.env.DEBUG_BUILD === '1' || process.env.DEBUG_BUILD === 'true') {
  $.verbose = true;
  console.log('DEBUG_BUILD enabled: zx verbose logging on');
}

checkPodmanMachineRunning();

/**
 * Registry setup (OCIR)
 * Note: Local builds do NOT require OCI env. We only resolve OCI data if we have credentials to push.
 */
const project = "save-the-wildlife";
let ocirLoginDone = false;
let namespace;
let regionKey;
let ocirUrl;

const ocirUser = process.env.OCIR_USER || process.env.OCIR_USERNAME;
const ocirToken = process.env.OCIR_TOKEN || process.env.OCIR_AUTH_TOKEN;
const namespaceEnv = process.env.TENANCY_NAMESPACE || process.env.NAMESPACE || process.env.namespace;
const ociRegionNameFromEnv = process.env.OCI_REGION;
const regionKeyEnv = process.env.REGION_KEY || process.env.region_key;

console.log("OCIR Credentials Check:");
console.log(`OCIR_USER: ${ocirUser ? 'set' : 'not set'}`);
console.log(`OCIR_TOKEN: ${ocirToken ? 'token present' : 'not set'}`);
console.log(`TENANCY_NAMESPACE: ${process.env.TENANCY_NAMESPACE}`);
console.log(`NAMESPACE: ${namespaceEnv || '(auto)'}`);

if (ocirUser && ocirToken) {
  try {
    namespace = namespaceEnv || (await getNamespace());
    if (!regionKeyEnv && !ociRegionNameFromEnv) {
      throw new Error("OCI_REGION or REGION_KEY must be set to push images to OCIR");
    }
    regionKey = (regionKeyEnv || (await getRegionByName(ociRegionNameFromEnv))['region-key']).toLowerCase();
    ocirUrl = `${regionKey}.ocir.io`;
    console.log({ namespace, regionKey });
    await containerLogin(process.env.TENANCY_NAMESPACE || namespace, ocirUser, ocirToken, ocirUrl);
    ocirLoginDone = true;
    console.log("OCIR login successful");
  } catch (e) {
    console.error("OCIR login failed or config missing:", e.message);
    console.log("Builds will complete but push will be skipped.");
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
  try {
    await cd(`${service}`);
    const currentVersion = await getNpmVersion();
    console.log(`Releasing ${service}:${currentVersion}`);
    await buildImage(`${service}`, currentVersion);
    await cd("..");
  } catch (error) {
    console.error(`Error building ${service}:`, error.message);
    throw error;
  }

  // Tag and push to OCIR if logged in
  const localImage = `${service}:${currentVersion}`;
  try {
    if (ocirLoginDone && ocirUrl && namespace) {
      const remoteImage = `${ocirUrl}/${namespace}/${project}/${service}:${currentVersion}`;
      await tagImage(localImage, remoteImage);
      await pushImage(remoteImage);
      console.log(`Pushed: ${chalk.yellow(remoteImage)}`);
    } else {
      console.log(`Built: ${chalk.yellow(localImage)}. Skipped push (no OCIR credentials).`);
    }
  } catch (error) {
    console.error(`Error tagging or pushing ${service} image:`, error.message);
    throw error;
  }
}

async function releaseGradle(service) {
  try {
    await cd(`${service}`);
    const currentVersion = await getVersionGradle();
    console.log(`Releasing ${service}:${currentVersion}`);
    await buildImage(`${service}`, currentVersion);
    await cd("..");
  } catch (error) {
    console.error(`Error building ${service}:`, error.message);
    throw error;
  }

  // Tag and push to OCIR if logged in
  const localImage = `${service}:${currentVersion}`;
  try {
    if (ocirLoginDone && ocirUrl && namespace) {
      const remoteImage = `${ocirUrl}/${namespace}/${project}/${service}:${currentVersion}`;
      await tagImage(localImage, remoteImage);
      await pushImage(remoteImage);
      console.log(`Pushed: ${chalk.yellow(remoteImage)}`);
    } else {
      console.log(`Built: ${chalk.yellow(localImage)}. Skipped push (no OCIR credentials).`);
    }
  } catch (error) {
    console.error(`Error tagging or pushing ${service} image:`, error.message);
    throw error;
  }
}
