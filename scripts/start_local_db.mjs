#!/usr/bin/env zx

import { whichContainerEngine, containerRun } from "./lib/container.mjs";
import { writeEnvJson, readEnvJson, setVariableFromEnvOrPrompt } from "./lib/utils.mjs";
import chalk from "chalk";

$.verbose = false;

console.log(chalk.yellow("Starting local Oracle Database 23ai container..."));

const ce = await whichContainerEngine();
console.log(`Using ${ce} as container engine.`);

let properties = await readEnvJson();

const containerName = "oracle23ai";
const image = "container-registry.oracle.com/database/free:23ai";
const port = 1521;
const dbName = "FREEPDB1";
const adminUser = "ADMIN";
const volumeName = "oracle-data";

// Prompt for local DB mode if not set
const useLocalDb = await setVariableFromEnvOrPrompt("USE_LOCAL_DB", "Use local Oracle DB? (true/false)", () => "false", "boolean");
if (!useLocalDb) {
  console.log(chalk.red("Local DB mode disabled. Exiting."));
  await $`exit 0`;
}

// Generate or prompt for password
const dbPassword = await setVariableFromEnvOrPrompt("ORACLE_PWD", "Oracle DB Admin Password", () => generateRandomString(12));
console.log(`Using password: ${chalk.yellow(dbPassword)}`);

// Check if container is already running
const { stdout: running } = await $`${ce} ps --filter name=${containerName} --format json`;
const isRunning = JSON.parse(running).length > 0;
if (isRunning) {
  console.log(chalk.green(`Container ${containerName} is already running.`));
} else {
  // Stop and remove if exists but stopped
  await $`${ce} stop ${containerName}`.catch(() => {});
  await $`${ce} rm ${containerName}`.catch(() => {});

  // Create volume if not exists
  await $`${ce} volume create ${volumeName}`.catch(() => {});

  // Run container
  const runCmd = [
    ce, "run", "-d",
    "--name", containerName,
    "-p", `${port}:1521`,
    "-e", `ORACLE_PWD=${dbPassword}`,
    "-v", `${volumeName}:/opt/oracle/oradata`,
    image
  ];
  await containerRun(runCmd.join(" "));
  console.log(chalk.green(`Started ${containerName} on port ${port}.`));

  // Wait for DB to be ready (poll for connection)
  console.log("Waiting for database to initialize...");
  let ready = false;
  for (let i = 0; i < 60; i++) {  // 10 min timeout
    await $`sleep 10`;
    const { exitCode } = await $`${ce} exec ${containerName} sqlplus ${adminUser}/${dbPassword}@${dbName} <<<'SELECT 1 FROM DUAL;'`.catch(() => ({ exitCode: 1 }));
    if (exitCode === 0) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    console.log(chalk.red("Database initialization timed out."));
    process.exit(1);
  }
  console.log(chalk.green("Database is ready."));
}

// Set environment properties for local DB
properties = {
  ...properties,
  USE_LOCAL_DB: useLocalDb,
  ORACLE_DB_HOST: "localhost",
  ORACLE_DB_PORT: port,
  ORACLE_DB_NAME: dbName,
  ORACLE_DB_USERNAME: adminUser,
  ORACLE_DB_PASSWORD: dbPassword,
  ORACLE_CONTAINER_NAME: containerName
};

await writeEnvJson(properties);

console.log(chalk.green("Local Oracle DB setup complete."));
