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
const DEFAULT_MODEL_AI_UPSTREAM_URL = "http://stwl-ollama-fallback:11434/api/chat";
const DEFAULT_MODEL_AI_BASE_MODEL_ID = "llama3.2:1b";
const DEFAULT_MODEL_AI_FT_MODEL_ID = "llama3.2:1b-stwl";

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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== "") return String(value);
  }
  return "";
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
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
  const pafCanvasEnabled = process.env.PAF_CANVAS_ENABLED || "false";
  const pafCanvasUseMarketplaceImage = process.env.PAF_CANVAS_USE_MARKETPLACE_IMAGE || "true";
  const pafCanvasAcceptMarketplaceTerms = process.env.PAF_CANVAS_ACCEPT_MARKETPLACE_TERMS || "true";
  const pafCanvasMarketplaceListingId = process.env.PAF_CANVAS_MARKETPLACE_LISTING_ID || "ocid1.appcataloglisting.oc1..aaaaaaaatzpebex5ocjaj33xkt6o2qxvcbvsb3fmcd2ypa74yogfj37246ba";
  const pafCanvasMarketplaceX86ImageOcid = process.env.PAF_CANVAS_MARKETPLACE_X86_IMAGE_OCID || "ocid1.image.oc1..aaaaaaaamsa27joy3ad3mjsbsfjgsddqmx6qtynqtx3hjumg6bmj5lwqnwma";
  const pafCanvasMarketplaceX86PackageVersion = process.env.PAF_CANVAS_MARKETPLACE_X86_PACKAGE_VERSION || "25.3.0.0.9.X86";
  const pafCanvasMarketplaceArmImageOcid = process.env.PAF_CANVAS_MARKETPLACE_ARM_IMAGE_OCID || "ocid1.image.oc1..aaaaaaaadhoxm6n2vfbzxrzsnfsvuaai64jrgiv6j5vahuhbuxzcdxauot5a";
  const pafCanvasMarketplaceArmPackageVersion = process.env.PAF_CANVAS_MARKETPLACE_ARM_PACKAGE_VERSION || "25.3.0.0.9.ARM";
  const pafCanvasShape = process.env.PAF_CANVAS_SHAPE || "VM.Standard.E4.Flex";
  const pafCanvasOcpus = process.env.PAF_CANVAS_OCPUS || "2";
  const pafCanvasMemoryInGbs = process.env.PAF_CANVAS_MEMORY_IN_GBS || "16";
  const pafCanvasImageOcid = process.env.PAF_CANVAS_IMAGE_OCID || "";
  const pafCanvasSshPublicKey = process.env.PAF_CANVAS_SSH_PUBLIC_KEY || "";
  const pafCanvasAllowedCidrs = process.env.PAF_CANVAS_ALLOWED_CIDRS || "0.0.0.0/0";
  const pafCanvasInstallScriptUrl = process.env.PAF_CANVAS_INSTALL_SCRIPT_URL || "";
  const pafCanvasContainerImageUri = process.env.PAF_CANVAS_CONTAINER_IMAGE_URI || "";
  const pafCanvasContainerName = process.env.PAF_CANVAS_CONTAINER_NAME || "oracle-applied-ai-label";
  const pafCanvasContainerPort = process.env.PAF_CANVAS_CONTAINER_PORT || "8080";
  const pafCanvasSelectAiProfile = process.env.PAF_CANVAS_SELECT_AI_PROFILE || "STWL_GAMEPLAY_AI";
  const pafCanvasSelectAiAgentTeam = process.env.PAF_CANVAS_SELECT_AI_AGENT_TEAM || "STWL_GAMEPLAY_COMMENTARY_TEAM";
  const pafCanvasGenaiModelId = process.env.PAF_CANVAS_GENAI_MODEL_ID || process.env.OCI_GENAI_MODEL_ID || "cohere.command-r-08-2024";

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
    const extra = [
      "",
      "# Optional Terraform-managed PAF Canvas host.",
      `paf_canvas_enabled                         = ${pafCanvasEnabled === "true" ? "true" : "false"}`,
      `paf_canvas_use_marketplace_image           = ${pafCanvasUseMarketplaceImage === "true" ? "true" : "false"}`,
      `paf_canvas_accept_marketplace_terms        = ${pafCanvasAcceptMarketplaceTerms === "true" ? "true" : "false"}`,
      `paf_canvas_marketplace_listing_id          = ${JSON.stringify(pafCanvasMarketplaceListingId)}`,
      `paf_canvas_marketplace_x86_image_ocid      = ${JSON.stringify(pafCanvasMarketplaceX86ImageOcid)}`,
      `paf_canvas_marketplace_x86_package_version = ${JSON.stringify(pafCanvasMarketplaceX86PackageVersion)}`,
      `paf_canvas_marketplace_arm_image_ocid      = ${JSON.stringify(pafCanvasMarketplaceArmImageOcid)}`,
      `paf_canvas_marketplace_arm_package_version = ${JSON.stringify(pafCanvasMarketplaceArmPackageVersion)}`,
      `paf_canvas_shape                           = ${JSON.stringify(pafCanvasShape)}`,
      `paf_canvas_ocpus                           = ${Number(pafCanvasOcpus) || 2}`,
      `paf_canvas_memory_in_gbs                   = ${Number(pafCanvasMemoryInGbs) || 16}`,
      `paf_canvas_image_ocid                      = ${JSON.stringify(pafCanvasImageOcid)}`,
      `paf_canvas_ssh_public_key                  = ${JSON.stringify(pafCanvasSshPublicKey)}`,
      `paf_canvas_allowed_cidrs                   = ${JSON.stringify(pafCanvasAllowedCidrs.split(",").map((item) => item.trim()).filter(Boolean))}`,
      `paf_canvas_install_script_url              = ${JSON.stringify(pafCanvasInstallScriptUrl)}`,
      `paf_canvas_container_image_uri             = ${JSON.stringify(pafCanvasContainerImageUri)}`,
      `paf_canvas_container_name                  = ${JSON.stringify(pafCanvasContainerName)}`,
      `paf_canvas_container_port                  = ${Number(pafCanvasContainerPort) || 8080}`,
      `paf_canvas_select_ai_profile               = ${JSON.stringify(pafCanvasSelectAiProfile)}`,
      `paf_canvas_select_ai_agent_team = ${JSON.stringify(pafCanvasSelectAiAgentTeam)}`,
      `paf_canvas_genai_model_id                  = ${JSON.stringify(pafCanvasGenaiModelId)}`,
      "",
    ].join("\n");
    await fs.appendFile("deploy/devops/tf-env/terraform.tfvars", extra, "utf8");
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
    model_ollama_chat_url: modelOllamaChatUrl,
    model_ollama_base_model_id: modelOllamaBaseModelId,
    model_ollama_custom_model_id: modelOllamaCustomModelId,
    paf_canvas_public_ip: terraformPafCanvasPublicIp,
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
  const pafMcpEnabled = process.env.PAF_MCP_ENABLED || "true";
  const defaultPafMcpPublicUrl = process.env.STWL_BASE_URL ? `${process.env.STWL_BASE_URL.replace(/\/+$/, "")}/paf/mcp` : "";
  const pafMcpPublicUrl = process.env.PAF_MCP_PUBLIC_URL || defaultPafMcpPublicUrl;
  const pafCanvasRunEndpointUrl = process.env.PAF_CANVAS_RUN_ENDPOINT_URL || "";
  const pafCanvasImportEnabled = process.env.PAF_CANVAS_IMPORT_ENABLED || "false";
  const pafCanvasHost = process.env.PAF_CANVAS_HOST || terraformPafCanvasPublicIp || "";
  const pafCanvasSshUser = process.env.PAF_CANVAS_SSH_USER || "opc";
  const pafCanvasSshKeySecretId = process.env.PAF_CANVAS_SSH_KEY_SECRET_ID || "";
  const pafCanvasFlowName = process.env.PAF_CANVAS_FLOW_NAME || "Save the Wildlife Commentator";
  const pafCanvasAgentFactoryUser = process.env.PAF_CANVAS_AGENT_FACTORY_USER || "";
  const pafCanvasLlmConfigName = process.env.PAF_CANVAS_LLM_CONFIG_NAME || "llm_model_entry";
  const pafCanvasRequireLlmConfig = process.env.PAF_CANVAS_REQUIRE_LLM_CONFIG || "false";
  const pafCanvasRoomId = process.env.PAF_CANVAS_ROOM_ID || "";
  const pafCanvasTimeoutMs = process.env.PAF_CANVAS_TIMEOUT_MS || "750";
  const pafCommentaryDeadlineMs = process.env.PAF_COMMENTARY_DEADLINE_MS || "60000";
  const pafCanvasReturnReserveMs = process.env.PAF_CANVAS_RETURN_RESERVE_MS || "250";
  const pafCanvasMinTimeoutMs = process.env.PAF_CANVAS_MIN_TIMEOUT_MS || "100";
  const pafCanvasVerifyTls = process.env.PAF_CANVAS_VERIFY_TLS || "false";
  const pafModelRouteMode = process.env.PAF_MODEL_ROUTE_MODE || "primary";
  const pafPrimaryModelProvider = process.env.PAF_PRIMARY_MODEL_PROVIDER || "oci-base";
  const pafCandidateModelProvider = process.env.PAF_CANDIDATE_MODEL_PROVIDER || "oci-fine-tuned";
  const ociBaseModelEndpointUrl = process.env.OCI_BASE_MODEL_ENDPOINT_URL || modelAiBaseEndpointUrl || "";
  const ociFtModelEndpointUrl = process.env.OCI_FT_MODEL_ENDPOINT_URL || modelAiFtEndpointUrl || "";
  const useTfOllamaUpstream = boolEnv("MODEL_AI_USE_OLLAMA_TF_OUTPUT", false);
  const selectedTfOllamaUrl = useTfOllamaUpstream ? modelOllamaChatUrl : "";
  const selectedTfOllamaBaseModelId = useTfOllamaUpstream ? modelOllamaBaseModelId : "";
  const selectedTfOllamaCustomModelId = useTfOllamaUpstream ? modelOllamaCustomModelId : "";
  if (modelOllamaChatUrl && !useTfOllamaUpstream) {
    console.log(`${chalk.yellow("[warn]")} model_ollama_chat_url exists but MODEL_AI_USE_OLLAMA_TF_OUTPUT is not true; using the in-cluster fallback upstream.`);
  }
  const modelAiBaseUpstreamUrl = firstNonEmpty(
    process.env.MODEL_AI_BASE_UPSTREAM_URL,
    selectedTfOllamaUrl,
    DEFAULT_MODEL_AI_UPSTREAM_URL
  );
  const modelAiFtUpstreamUrl = firstNonEmpty(
    process.env.MODEL_AI_FT_UPSTREAM_URL,
    selectedTfOllamaUrl,
    DEFAULT_MODEL_AI_UPSTREAM_URL
  );
  const modelAiBaseUpstreamFormat = process.env.MODEL_AI_BASE_UPSTREAM_FORMAT || process.env.MODEL_AI_UPSTREAM_FORMAT || "ollama";
  const modelAiFtUpstreamFormat = process.env.MODEL_AI_FT_UPSTREAM_FORMAT || process.env.MODEL_AI_UPSTREAM_FORMAT || "ollama";
  const modelAiBaseUpstreamModelId = firstNonEmpty(
    process.env.MODEL_AI_BASE_UPSTREAM_MODEL_ID,
    selectedTfOllamaBaseModelId,
    DEFAULT_MODEL_AI_BASE_MODEL_ID
  );
  const modelAiFtUpstreamModelId = firstNonEmpty(
    process.env.MODEL_AI_FT_UPSTREAM_MODEL_ID,
    selectedTfOllamaCustomModelId,
    DEFAULT_MODEL_AI_FT_MODEL_ID
  );
  const modelAiRequireUpstreamReady = process.env.MODEL_AI_REQUIRE_UPSTREAM_READY || (useTfOllamaUpstream ? "true" : "false");
  const modelAiRequirePrivateOllama = process.env.MODEL_AI_REQUIRE_PRIVATE_OLLAMA || (useTfOllamaUpstream ? "true" : "false");
  const ociModelEndpointAuthSecretId = process.env.OCI_MODEL_ENDPOINT_AUTH_SECRET_ID || modelEndpointAuthSecretId || "";
  const ociModelEndpointTimeoutMs = process.env.OCI_MODEL_ENDPOINT_TIMEOUT_MS || "60000";
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
      .replace(/PAF_MCP_ENABLED/g, pafMcpEnabled)
      .replace(/PAF_MCP_PUBLIC_URL/g, pafMcpPublicUrl)
      .replace(/PAF_CANVAS_RUN_ENDPOINT_URL/g, pafCanvasRunEndpointUrl)
      .replace(/PAF_CANVAS_IMPORT_ENABLED/g, pafCanvasImportEnabled)
      .replace(/PAF_CANVAS_HOST/g, pafCanvasHost)
      .replace(/PAF_CANVAS_SSH_USER/g, pafCanvasSshUser)
      .replace(/PAF_CANVAS_SSH_KEY_SECRET_ID/g, pafCanvasSshKeySecretId)
      .replace(/PAF_CANVAS_FLOW_NAME/g, pafCanvasFlowName)
      .replace(/PAF_CANVAS_AGENT_FACTORY_USER/g, pafCanvasAgentFactoryUser)
      .replace(/PAF_CANVAS_LLM_CONFIG_NAME/g, pafCanvasLlmConfigName)
      .replace(/PAF_CANVAS_REQUIRE_LLM_CONFIG/g, pafCanvasRequireLlmConfig)
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
      .replace(/MODEL_AI_BASE_UPSTREAM_URL/g, modelAiBaseUpstreamUrl)
      .replace(/MODEL_AI_FT_UPSTREAM_URL/g, modelAiFtUpstreamUrl)
      .replace(/MODEL_AI_BASE_UPSTREAM_FORMAT/g, modelAiBaseUpstreamFormat)
      .replace(/MODEL_AI_FT_UPSTREAM_FORMAT/g, modelAiFtUpstreamFormat)
      .replace(/MODEL_AI_BASE_UPSTREAM_MODEL_ID/g, modelAiBaseUpstreamModelId)
      .replace(/MODEL_AI_FT_UPSTREAM_MODEL_ID/g, modelAiFtUpstreamModelId)
      .replace(/MODEL_AI_REQUIRE_UPSTREAM_READY/g, modelAiRequireUpstreamReady)
      .replace(/MODEL_AI_REQUIRE_PRIVATE_OLLAMA/g, modelAiRequirePrivateOllama)
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
