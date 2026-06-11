#!/usr/bin/env zx

import { exitWithError } from "./lib/utils.mjs";
import { whichContainerEngine } from "./lib/container.mjs";

$.verbose = false;

const containerName = "coherence_multiplayer";

const ce = await whichContainerEngine();

try {
  const { stdout, stderr, exitCode } = await $`${ce} \
    run --name ${containerName} \
    -d \
    --rm \
    -p 1408:1408 \
    ghcr.io/oracle/coherence-ce:25.03.1`;
  if (exitCode == 0) {
    console.log(chalk.green(stdout.trim()));
  } else {
    exitWithError(stderr);
  }
} catch (error) {
  exitWithError(error.stderr);
}
