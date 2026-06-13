#!/usr/bin/env zx

import fs from "node:fs/promises";
import { createSSHKeyPair } from "./lib/crypto.mjs";
import {
  getOciConfigValue,
  getNamespace,
  getRegions,
  getTenancyId,
  searchCompartmentIdByName,
} from "./lib/oci.mjs";
import { setVariableFromEnvOrPrompt, exitWithError, printRegionNames } from "./lib/utils.mjs";

$.verbose = false;

const { _ } = argv;
const [action] = _;

if (action === "env") {
  await envTFvars();
  process.exit(0);
}

if (action === "devops") {
  await devopsTFvars();
  process.exit(0);
}

if (action === "vm") {
  await vmTFvars();
  process.exit(0);
}

if (action === "ci") {
  await ciTFvars();
  process.exit(0);
}

console.log("Usage:");
console.log("\tnpx zx scripts/tfvars.mjs env");
console.log("\tnpx zx scripts/tfvars.mjs devops");
console.log("\tnpx zx scripts/tfvars.mjs vm");
console.log("\tnpx zx scripts/tfvars.mjs ci");

process.exit(0);

async function setVariableFromEnvDefaultOrPrompt(envKey, questionText, defaultValue = "", options = {}) {
  const { printChoices, source = "detected default" } = options;
  if (process.env[envKey]) {
    console.log(`${chalk.green("[ok]")} ${envKey} from environment`);
    return process.env[envKey];
  }
  if (defaultValue) {
    console.log(`${chalk.green("[ok]")} ${envKey} from ${source}`);
    return defaultValue;
  }
  if (printChoices) {
    await printChoices();
  }
  return question(`${questionText}: `);
}

async function defaultRegionName(regions) {
  const configuredRegion = await getOciConfigValue("region");
  if (!configuredRegion) {
    return "";
  }
  return regions.some((region) => region.name === configuredRegion)
    ? configuredRegion
    : "";
}

async function defaultCompartmentId() {
  return process.env.DEVOPS_COMPARTMENT_OCID ||
    process.env.OCI_COMPARTMENT_OCID ||
    await getOciConfigValue("compartment_id") ||
    await getOciConfigValue("compartment_ocid");
}

async function defaultCompartmentName() {
  const configuredName = await getOciConfigValue("compartment_name") || await getOciConfigValue("compartment");
  if (configuredName && !configuredName.startsWith("ocid1.")) {
    return configuredName;
  }

  const email = await defaultOciUserEmail();
  const localPart = email.split("@")[0] || "";
  const parts = localPart.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2) {
    return "";
  }

  const firstName = titleCase(parts[0]);
  const lastInitial = parts[1].slice(0, 1).toUpperCase();
  return findActiveCompartmentName([`${firstName}_${lastInitial}`]);
}

async function findActiveCompartmentName(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const { stdout } = await $`oci iam compartment list --compartment-id-in-subtree true --name ${candidate}`;
      const { data } = JSON.parse(stdout.trim());
      if (data.some((compartment) => compartment.name === candidate && compartment["lifecycle-state"] === "ACTIVE")) {
        return candidate;
      }
    } catch (_) {
      // Keep probing other candidate names.
    }
  }
  return "";
}

async function defaultOciUserEmail() {
  const userId = process.env.OCI_CS_USER_OCID ||
    process.env.OCI_USER_OCID ||
    await getOciConfigValue("user");
  if (!userId) {
    return "";
  }
  try {
    const { stdout } = await $`oci iam user get --user-id ${userId}`;
    const { data } = JSON.parse(stdout.trim());
    if (data.email) {
      return data.email;
    }
    const userName = data.name || "";
    const nameCandidate = userName.includes("/") ? userName.split("/").pop() : userName;
    return nameCandidate.includes("@") ? nameCandidate : "";
  } catch (_) {
    return "";
  }
}

async function defaultGithubUrl() {
  try {
    const { stdout } = await $`git remote get-url origin`;
    return stdout.trim().replace(/\.git$/, "");
  } catch (_) {
    return "";
  }
}

async function defaultGithubToken() {
  try {
    await which("gh");
    const { stdout } = await $`gh auth token`;
    return stdout.trim();
  } catch (_) {
    return "";
  }
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

async function envTFvars() {
  const tenancyId = await getTenancyId();

  const regions = await getRegions();
  const regionName = await setVariableFromEnvDefaultOrPrompt(
    "OCI_REGION",
    "OCI Region name",
    await defaultRegionName(regions),
    { printChoices: async () => printRegionNames(regions), source: "OCI config" }
  );

  const compartmentIdDefault = await defaultCompartmentId();
  let compartmentId = compartmentIdDefault;

  if (compartmentId) {
    console.log(`${chalk.green("[ok]")} DEVOPS_COMPARTMENT_OCID from OCI config/env`);
  } else {
    const compartmentName = await setVariableFromEnvDefaultOrPrompt(
      "DEVOPS_COMPARTMENT_NAME",
      "DevOps Compartment Name (root)",
      await defaultCompartmentName(),
      { source: "OCI user profile" }
    );

    compartmentId = await searchCompartmentIdByName(
      compartmentName || "root"
    );
  }

  const onsEmail = await setVariableFromEnvDefaultOrPrompt(
    "ONS_EMAIL",
    "Oracle Notification Service (ONS) email",
    await defaultOciUserEmail(),
    { source: "OCI user profile" }
  );

  const githubToken = await setVariableFromEnvDefaultOrPrompt(
    "GITHUB_TOKEN",
    "GitHub Token",
    await defaultGithubToken(),
    { sensitive: true, source: "GitHub CLI" }
  );

  try {
    let { exitCode, stderr } =
      await $`sed 's/REGION_NAME/${regionName}/' deploy/devops/tf-env/terraform.tfvars.template \
                 | sed 's/TENANCY_OCID/${tenancyId}/' \
                 | sed 's/COMPARTMENT_OCID/${compartmentId}/' \
                 | sed 's/SUBSCRIPTION_EMAIL/${onsEmail}/' \
                 | sed 's/GITHUB_TOKEN/${githubToken}/' > deploy/devops/tf-env/terraform.tfvars`;
    if (exitCode !== 0) {
      exitWithError(
        `Error creating deploy/devops/tf-env/terraform.tfvars: ${stderr}`
      );
    }
    console.log(
      `${chalk.green("deploy/devops/tf-env/terraform.tfvars")} created.`
    );
  } catch (error) {
    exitWithError(error.stderr);
  }
}

async function devopsTFvars() {
  const tenancyId = await getTenancyId();

  const namespace = await getNamespace();

  const regions = await getRegions();
  const regionName = await setVariableFromEnvDefaultOrPrompt(
    "OCI_REGION",
    "OCI Region name",
    await defaultRegionName(regions),
    { printChoices: async () => printRegionNames(regions), source: "OCI config" }
  );

  await cd("deploy/devops/tf-env");

  const { key } = regions.find((r) => r.name === regionName);
  const regionKey = key;

  const { stdout } = await $`terraform output -json`;
  const terraformOutput = JSON.parse(stdout);

  const values = {};
  for (const [key, content] of Object.entries(terraformOutput)) {
    values[key] = content.value;
  }

  const {
    compartment_id: compartmentId,
    deploy_id,
    devops_ons_topic_ocid: devopsOnsTopicId,
    github_access_token_secret_ocid: githubAccessTokenSecretId,
    oke_cluster_ocid: okeClusterId,
    user_name: userName,
    user_auth_token_id: userAuthTokenId,
    adb_admin_password_id: adbAdminPasswordId,
    adb_service: adbService,
    adb_id: adbId,
    oci_model_endpoint_auth_secret_id: modelEndpointAuthSecretId,
    model_ai_base_endpoint_url: modelAiBaseEndpointUrl,
    model_ai_ft_endpoint_url: modelAiFtEndpointUrl,
  } = values;

  await cd("../../..");

  console.log(`Environment deployment id: ${deploy_id}`);

  const githubURLParam = await setVariableFromEnvDefaultOrPrompt(
    "GITHUB_URL",
    "GitHub URL",
    await defaultGithubUrl(),
    { source: "git origin remote" }
  );

  const githubURL = githubURLParam.endsWith(".git")
    ? githubURLParam.replace(".git", "")
    : githubURLParam;

  const githubUser = githubURL.split("/").reverse()[1];

  const pafImageRepository = process.env.PAF_IMAGE_REPOSITORY || "AUTO";
  const pafVersion = process.env.PAF_VERSION || "latest";
  const genaiModelId = process.env.OCI_GENAI_MODEL_ID || "cohere.command-r-08-2024";
  const pafCanvasRunEndpointUrl = process.env.PAF_CANVAS_RUN_ENDPOINT_URL || "";
  const pafCanvasRoomId = process.env.PAF_CANVAS_ROOM_ID || "";
  const pafCanvasTimeoutMs = process.env.PAF_CANVAS_TIMEOUT_MS || "3000";
  const pafCommentaryDeadlineMs = process.env.PAF_COMMENTARY_DEADLINE_MS || "9000";
  const pafCanvasReturnReserveMs = process.env.PAF_CANVAS_RETURN_RESERVE_MS || "1000";
  const pafCanvasMinTimeoutMs = process.env.PAF_CANVAS_MIN_TIMEOUT_MS || "250";
  const pafCanvasVerifyTls = process.env.PAF_CANVAS_VERIFY_TLS || "false";
  const pafModelRouteMode = process.env.PAF_MODEL_ROUTE_MODE || "shadow";
  const pafPrimaryModelProvider = process.env.PAF_PRIMARY_MODEL_PROVIDER || "oci-base";
  const pafCandidateModelProvider = process.env.PAF_CANDIDATE_MODEL_PROVIDER || "oci-fine-tuned";
  const ociBaseModelEndpointUrl = process.env.OCI_BASE_MODEL_ENDPOINT_URL || modelAiBaseEndpointUrl || "";
  const ociFtModelEndpointUrl = process.env.OCI_FT_MODEL_ENDPOINT_URL || modelAiFtEndpointUrl || "";
  const ociModelEndpointAuthSecretId = process.env.OCI_MODEL_ENDPOINT_AUTH_SECRET_ID || modelEndpointAuthSecretId || "";
  const ociModelEndpointTimeoutMs = process.env.OCI_MODEL_ENDPOINT_TIMEOUT_MS || "8000";
  const ociModelEndpointVerifyTls = process.env.OCI_MODEL_ENDPOINT_VERIFY_TLS || "true";
  const pafTracePersist = process.env.PAF_TRACE_PERSIST || "true";
  const pafEvalEnabled = process.env.PAF_EVAL_ENABLED || "true";
  const pafModelFastPathEnabled = process.env.PAF_MODEL_FAST_PATH_ENABLED || "true";
  const pafEvalRubricVersion = process.env.PAF_EVAL_RUBRIC_VERSION || "stwl-commentary-v1";
  const pafTrainingCaptureEnabled = process.env.PAF_TRAINING_CAPTURE_ENABLED || "true";

  // Create the terraform.tfvars file using a safer approach
  try {
    // Read the template
    const templateContent = await fs.readFile('deploy/devops/tf-devops/terraform.tfvars.template', 'utf8');

    // Replace all placeholders
    let content = templateContent
      .replace(/REGION_NAME/g, regionName)
      .replace(/TENANCY_OCID/g, tenancyId)
      .replace(/COMPARTMENT_OCID/g, compartmentId)
      .replace(/NAMESPACE/g, namespace)
      .replace(/REGION_KEY/g, regionKey)
      .replace(/ONS_TOPIC_ID/g, devopsOnsTopicId)
      .replace(/OKE_CLUSTER_ID/g, okeClusterId)
      .replace(/OCIR_USER/g, userName)
      .replace(/GITHUB_SECRET_OCID/g, githubAccessTokenSecretId)
      .replace(/USER_AUTH_TOKEN_OCID/g, userAuthTokenId)
      .replace(/ADB_ADMIN_PASSWORD_OCID/g, adbAdminPasswordId)
      .replace(/ADB_SERVICE/g, adbService)
      .replace(/ADB_OCID/g, adbId)
      .replace(/PAF_IMAGE_REPOSITORY/g, pafImageRepository)
      .replace(/PAF_VERSION/g, pafVersion)
      .replace(/OCI_GENAI_MODEL_ID/g, genaiModelId)
      .replace(/PAF_CANVAS_RUN_ENDPOINT_URL/g, pafCanvasRunEndpointUrl)
      .replace(/PAF_CANVAS_ROOM_ID/g, pafCanvasRoomId)
      .replace(/PAF_CANVAS_TIMEOUT_MS/g, pafCanvasTimeoutMs)
      .replace(/PAF_COMMENTARY_DEADLINE_MS/g, pafCommentaryDeadlineMs)
      .replace(/PAF_CANVAS_RETURN_RESERVE_MS/g, pafCanvasReturnReserveMs)
      .replace(/PAF_CANVAS_MIN_TIMEOUT_MS/g, pafCanvasMinTimeoutMs)
      .replace(/PAF_CANVAS_VERIFY_TLS/g, pafCanvasVerifyTls)
      .replace(/PAF_MODEL_ROUTE_MODE/g, pafModelRouteMode)
      .replace(/PAF_PRIMARY_MODEL_PROVIDER/g, pafPrimaryModelProvider)
      .replace(/PAF_CANDIDATE_MODEL_PROVIDER/g, pafCandidateModelProvider)
      .replace(/OCI_BASE_MODEL_ENDPOINT_URL/g, ociBaseModelEndpointUrl)
      .replace(/OCI_FT_MODEL_ENDPOINT_URL/g, ociFtModelEndpointUrl)
      .replace(/OCI_MODEL_ENDPOINT_AUTH_SECRET_ID/g, ociModelEndpointAuthSecretId)
      .replace(/OCI_MODEL_ENDPOINT_TIMEOUT_MS/g, ociModelEndpointTimeoutMs)
      .replace(/OCI_MODEL_ENDPOINT_VERIFY_TLS/g, ociModelEndpointVerifyTls)
      .replace(/PAF_TRACE_PERSIST/g, pafTracePersist)
      .replace(/PAF_EVAL_ENABLED/g, pafEvalEnabled)
      .replace(/PAF_MODEL_FAST_PATH_ENABLED/g, pafModelFastPathEnabled)
      .replace(/PAF_EVAL_RUBRIC_VERSION/g, pafEvalRubricVersion)
      .replace(/PAF_TRAINING_CAPTURE_ENABLED/g, pafTrainingCaptureEnabled)
      .replace(/GITHUB_REPOSITORY_URL/g, githubURL)
      .replace(/GITHUB_USER/g, githubUser);

    // Write the final file
    await fs.writeFile('deploy/devops/tf-devops/terraform.tfvars', content, 'utf8');

    console.log(
      `${chalk.green("deploy/devops/tf-devops/terraform.tfvars")} created.`
    );
  } catch (error) {
    exitWithError(error.stderr);
  }
}

async function vmTFvars() {
  const tenancyId = await getTenancyId();

  const regions = await getRegions();
  const regionName = await setVariableFromEnvOrPrompt(
    "OCI_REGION",
    "OCI Region name",
    async () => printRegionNames(regions)
  );

  const compartmentName = await setVariableFromEnvOrPrompt(
    "VM_COMPARTMENT_NAME",
    "VM Deployment Compartment Name (root)"
  );

  const compartmentId = await searchCompartmentIdByName(
    compartmentName || "root"
  );

  const sshPathParam = path.join(os.homedir(), ".ssh", "stwl");
  await createSSHKeyPair(sshPathParam);

  const escapedSlash = "\\" + "/";
  const replacedSshPathParam = sshPathParam.replaceAll("/", escapedSlash);
  const replaceSSHContentCommand = `s/PATH_TO_PUBLIC_KEY/${replacedSshPathParam}.pub/`;

  try {
    let { exitCode, stderr } =
      await $`sed 's/REGION_NAME/${regionName}/' deploy/vm/terraform/terraform.tfvars.template \
                 | sed 's/TENANCY_OCID/${tenancyId}/' \
                 | sed 's/COMPARTMENT_OCID/${compartmentId}/' \
                 | sed '${replaceSSHContentCommand}' > deploy/vm/terraform/terraform.tfvars`;
    if (exitCode !== 0) {
      exitWithError(
        `Error creating deploy/vm/terraform/terraform.tfvars: ${stderr}`
      );
    }
    console.log(
      `${chalk.green("deploy/vm/terraform/terraform.tfvars")} created.`
    );
  } catch (error) {
    exitWithError(error.stderr);
  }
}

async function ciTFvars() {
  const tenancyId = await getTenancyId();

  const regions = await getRegions();
  const regionName = await setVariableFromEnvOrPrompt(
    "OCI_REGION",
    "OCI Region name",
    async () => printRegionNames(regions)
  );

  const compartmentName = await setVariableFromEnvOrPrompt(
    "VM_COMPARTMENT_NAME",
    "CI Deployment Compartment Name (root)"
  );

  const compartmentId = await searchCompartmentIdByName(
    compartmentName || "root"
  );

  await cd("deploy/vm/terraform");
  const { stdout } = await $`terraform output -json`;
  const terraformOutput = JSON.parse(stdout);
  const values = {};
  for (const [key, content] of Object.entries(terraformOutput)) {
    values[key] = content.value;
  }
  const { subnetId } = values;
  await cd("../../..");

  const ciPrivateIPAddress = await setVariableFromEnvOrPrompt(
    "CI_PRIVATE_IP",
    "Container Instance Private IP Address"
  );

  try {
    let { exitCode, stderr } =
      await $`sed 's/REGION_NAME/${regionName}/' deploy/vm/tf-ci/terraform.tfvars.template \
                 | sed 's/TENANCY_OCID/${tenancyId}/' \
                 | sed 's/COMPARTMENT_OCID/${compartmentId}/' \
                 | sed 's/PUBLIC_SUBNET_OCID/${subnetId}/' \
                 | sed 's/CI_PRIVATE_IP/${ciPrivateIPAddress}/'> deploy/vm/tf-ci/terraform.tfvars`;
    if (exitCode !== 0) {
      exitWithError(
        `Error creating deploy/vm/tf-ci/terraform.tfvars: ${stderr}`
      );
    }
    console.log(`${chalk.green("deploy/vm/tf-ci/terraform.tfvars")} created.`);
  } catch (error) {
    exitWithError(error.stderr);
  }
}
