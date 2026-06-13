#!/usr/bin/env zx
//container.mjs
import chalk from "chalk";
import { exitWithError } from "./utils.mjs";

export async function whichContainerEngine() {
  try {
    await which("docker");
    return "docker";
  } catch (_) {
    try {
      await which("podman");
      return "podman";
    } catch (err2) {
      exitWithError("Neither docker nor podman is installed in the build environment");
    }
  }
}

const ce = await whichContainerEngine();
console.log(`${chalk.blue("Container engine")}: ${ce}`);

export async function checkPodmanMachineRunning() {
  if (ce !== "podman") return;

  // On Linux, podman runs natively and 'podman machine' is not used.
  // On macOS/Windows, 'podman machine' must be running.
  let machineSupported = false;
  try {
    await $`podman machine --help`;
    machineSupported = true;
  } catch (_) {
    machineSupported = false;
  }

  if (!machineSupported) {
    console.log(`${chalk.green("[ok]")} podman available (no machine required)`);
    return;
  }

  try {
    const state = (await $`podman machine info --format {{.Host.MachineState}}`).stdout.trim();
    if (state === "Stopped") {
      console.log(`Run ${chalk.yellow("podman machine start")} before continue`);
      exitWithError("Podman machine stopped");
    }
    console.log(`${chalk.green("[ok]")} podman machine running`);
  } catch (error) {
    console.log(`${chalk.yellow("Warning")}: unable to query podman machine status; proceeding`);
  }
}

export async function containerLogin(namespace, user, token, url) {
  try {
    const { stdout, stderr, exitCode } =
      await $`${ce} login -u ${namespace}/${user} -p ${token} ${url}`;
    if (exitCode == 0) {
      console.log(`${chalk.yellow(url)}: ${chalk.green(stdout.trim())}`);
    } else {
      console.error(chalk.red(stderr.trim()));
      throw new Error(`OCIR login returned exitCode ${exitCode}: ${stderr.trim()}`);
    }
  } catch (error) {
    const stderr = (error && error.stderr ? error.stderr : `${error}`).toString().trim();
    console.error(chalk.red(stderr));
    // Do not exit here; let caller decide to proceed without push
    throw new Error(`OCIR login failed for ${namespace}/${user} @ ${url}: ${stderr}`);
  }
}

export async function tagImage(local, remote) {
  console.log(`${ce} tag ${local} ${remote}`);
  console.time(`[tag] ${local} -> ${remote}`);
  try {
    await $`${ce} tag ${local} ${remote}`;
    console.timeEnd(`[tag] ${local} -> ${remote}`);
  } catch (error) {
    console.timeEnd(`[tag] ${local} -> ${remote}`);
    const msg = error.stderr || error.message || String(error);
    console.error(msg);
    throw new Error(msg);
  }
}

export async function pushImage(remote) {
  console.log(`${ce} push ${remote}`);
  console.time(`[push] ${remote}`);
  try {
    await $`${ce} push ${remote}`;
    console.timeEnd(`[push] ${remote}`);
  } catch (error) {
    console.timeEnd(`[push] ${remote}`);
    const msg = error.stderr || error.message || String(error);
    console.error(msg);
    throw new Error(msg);
  }
}

// FIXME
export async function build_image(name, version) {
  console.log(`${ce} build . -t ${name}:${version}`);
  try {
    await $`${ce} build . -t ${name}:${version}`;
  } catch (error) {
    exitWithError(error.stderr);
  }
}

export async function buildImage(name, version, options = {}) {
  const tag = `${name}:${version}`;
  const dockerfile = options.dockerfile || process.env.DOCKERFILE || "";
  const buildLabel = dockerfile ? `${ce} build -f ${dockerfile} . -t ${tag}` : `${ce} build . -t ${tag}`;
  console.log(buildLabel);
  console.time(`[build] ${tag}`);
  try {
    if (dockerfile) {
      await $`${ce} build -f ${dockerfile} . -t ${tag}`;
    } else {
      await $`${ce} build . -t ${tag}`;
    }
    console.timeEnd(`[build] ${tag}`);
  } catch (error) {
    console.timeEnd(`[build] ${tag}`);
    exitWithError(error.stderr || error.message || String(error));
  }
}
