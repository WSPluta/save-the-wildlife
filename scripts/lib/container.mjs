#!/usr/bin/env zx
//container.mjs
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
    }
  } catch (error) {
    console.error(chalk.red(error.stderr.trim()));
    const yellowUserString = chalk.yellow(user);
    exitWithError(
      `Review the user ${yellowUserString} and token pair, and try again.`
    );
  }
}

export async function tagImage(local, remote) {
  console.log(`${ce} tag ${local} ${remote}`);
  try {
    await $`${ce} tag ${local} ${remote}`;
  } catch (error) {
    exitWithError(error.stderr);
  }
}

export async function pushImage(remote) {
  console.log(`${ce} push ${remote}`);
  try {
    await $`${ce} push ${remote}`;
  } catch (error) {
    exitWithError(error.stderr);
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

export async function buildImage(name, version) {
  console.log(`${ce} build . -t ${name}:${version}`);
  try {
    await $`${ce} build . -t ${name}:${version}`;
  } catch (error) {
    exitWithError(error.stderr);
  }
}
