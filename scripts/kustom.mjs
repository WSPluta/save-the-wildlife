import { createSelfSignedCert } from "./lib/tls.mjs";
import { getVersionGradle } from "./lib/gradle.mjs";
import { getNpmVersion } from "./lib/npm.mjs";
import { getNamespace } from "./lib/oci.mjs";
import { exitWithError } from "./lib/utils.mjs";
import { readFile } from "node:fs/promises";

$.verbose = false;

const { _ } = argv;
const [key, adbAdminPassword, adbService, adbWalletPassword = ""] = _;
const DEFAULT_MODEL_AI_UPSTREAM_URL = "http://stwl-ollama-fallback:11434/api/chat";
const DEFAULT_MODEL_AI_BASE_MODEL_ID = "llama3.2:1b";
const DEFAULT_MODEL_AI_FT_MODEL_ID = "llama3.2:1b-stwl";

const regionKey = key;
const namespace = await getNamespace();

await createKustomizationYaml(regionKey, namespace);
await createModelAiUpstreamPatchFile();

await createWsServerConfigFile(adbAdminPassword, adbService);
await createScoreConfigFile(adbAdminPassword, adbService);
await createReplayConfigFile(adbAdminPassword, adbService);
await createPrivateAgentFactoryConfigFile(adbAdminPassword, adbService, adbWalletPassword);
await createCerts();

async function createKustomizationYaml(regionKey, namespace) {
  const pwdOutput = (await $`pwd`).stdout.trim();
  await cd(`${pwdOutput}/server`);
  const wsServerVersion = await getNpmVersion();
  await cd(`${pwdOutput}/web`);
  const webVersion = await getNpmVersion();
  await cd(`${pwdOutput}/score`);
  const scoreVersion = await getVersionGradle();
  await cd(`${pwdOutput}/replay`);
  const replayVersion = await getVersionGradle();
  await cd(`${pwdOutput}/bots`);
  const botsVersion = await getNpmVersion();
  await cd(`${pwdOutput}/private-agent-factory`);
  const privateAgentFactoryVersion = await getNpmVersion();
  await cd(pwdOutput);
  const pafVersion = process.env.PAF_VERSION || privateAgentFactoryVersion;
  const modelAiInferenceVersion = process.env.MODEL_AI_INFERENCE_VERSION || await readVersionFile(
    `${pwdOutput}/model-ai/inference/VERSION`,
    "latest"
  );
  const pafImageRepository = process.env.PAF_IMAGE_REPOSITORY && process.env.PAF_IMAGE_REPOSITORY !== "AUTO"
    ? process.env.PAF_IMAGE_REPOSITORY
    : `${regionKey}.ocir.io/${namespace}/save-the-wildlife/private-agent-factory`;
  const modelAiInferenceImageRepository = process.env.MODEL_AI_INFERENCE_IMAGE_REPOSITORY || `${regionKey}.ocir.io/${namespace}/save-the-wildlife/model-ai-inference`;

  console.log(`ws-server v${wsServerVersion}`);
  console.log(`web v${webVersion}`);
  console.log(`score v${scoreVersion}`);
  console.log(`replay v${replayVersion}`);
  console.log(`bots v${botsVersion}`);
  console.log(`private-agent-factory v${pafVersion}`);
  console.log(`private-agent-factory image ${pafImageRepository}`);
  console.log(`model-ai-inference v${modelAiInferenceVersion}`);
  console.log(`model-ai-inference image ${modelAiInferenceImageRepository}`);

  await cd("./deploy/k8s/overlays/devops");
  try {
    let { exitCode, stderr } =
      await $`sed 's/REGION_KEY/${regionKey}/' kustomization.yaml_template \
    | sed 's/WEB_VERSION/${webVersion}/' \
    | sed 's/WS_SERVER_VERSION/${wsServerVersion}/' \
    | sed 's/SCORE_VERSION/${scoreVersion}/' \
    | sed 's/REPLAY_VERSION/${replayVersion}/' \
    | sed 's/BOTS_VERSION/${botsVersion}/' \
    | sed 's|PAF_IMAGE_REPOSITORY|${pafImageRepository}|' \
    | sed 's/PAF_VERSION/${pafVersion}/' \
    | sed 's|MODEL_AI_INFERENCE_IMAGE_REPOSITORY|${modelAiInferenceImageRepository}|' \
    | sed 's/MODEL_AI_INFERENCE_VERSION/${modelAiInferenceVersion}/' \
    | sed 's/NAMESPACE/${namespace}/' > kustomization.yaml`;
    if (exitCode !== 0) {
      exitWithError(`Error creating kustomization.yaml: ${stderr}`);
    }
    console.log(`Overlay ${chalk.green("kustomization.yaml")} created.`);
  } catch (error) {
    exitWithError(error.stderr);
  } finally {
    await cd(pwdOutput);
  }
}

async function readVersionFile(filePath, fallback) {
  try {
    const value = (await readFile(filePath, "utf8")).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function envValue(name, fallback = "") {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") return fallback;
  return value;
}

async function createModelAiUpstreamPatchFile() {
  const pwdOutput = (await $`pwd`).stdout.trim();
  const baseUpstreamUrl = envValue("MODEL_AI_BASE_UPSTREAM_URL", DEFAULT_MODEL_AI_UPSTREAM_URL);
  const ftUpstreamUrl = envValue("MODEL_AI_FT_UPSTREAM_URL", DEFAULT_MODEL_AI_UPSTREAM_URL);
  const baseFormat = envValue("MODEL_AI_BASE_UPSTREAM_FORMAT", envValue("MODEL_AI_UPSTREAM_FORMAT", "ollama"));
  const ftFormat = envValue("MODEL_AI_FT_UPSTREAM_FORMAT", envValue("MODEL_AI_UPSTREAM_FORMAT", "ollama"));
  const baseModelId = envValue("MODEL_AI_BASE_UPSTREAM_MODEL_ID", DEFAULT_MODEL_AI_BASE_MODEL_ID);
  const ftModelId = envValue("MODEL_AI_FT_UPSTREAM_MODEL_ID", DEFAULT_MODEL_AI_FT_MODEL_ID);

  function envEntries(url, format, modelId) {
    const entries = [
      ["STWL_UPSTREAM_URL", url],
      ["STWL_UPSTREAM_FORMAT", format],
    ];
    if (modelId) entries.push(["STWL_MODEL_ID", modelId]);
    return entries.map(([name, value]) => `            - name: ${name}
              value: ${yamlString(value)}`).join("\n");
  }

  const content = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: stwl-base-commentary
spec:
  template:
    spec:
      containers:
        - name: model-ai-inference
          env:
${envEntries(baseUpstreamUrl, baseFormat, baseModelId)}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stwl-ft-commentary
spec:
  template:
    spec:
      containers:
        - name: model-ai-inference
          env:
${envEntries(ftUpstreamUrl, ftFormat, ftModelId)}
`;

  await cd("./deploy/k8s/overlays/devops");
  try {
    await fs.writeFile("patch_model_ai_upstream.yaml", content, "utf8");
    console.log(`Overlay ${chalk.green("patch_model_ai_upstream.yaml")} created.`);
  } catch (error) {
    exitWithError(error.stderr || error.message);
  } finally {
    await cd(pwdOutput);
  }
}

async function createWsServerConfigFile(adbAdminPassword, adbService) {
  const pwdOutput = (await $`pwd`).stdout.trim();
  await cd("./deploy/k8s/base/ws-server/");
  const replaceCmdAdbPassword = `s/TEMPLATE_ADB_PASSWORD/${adbAdminPassword}/`;
  const replaceCmdAdbService = `s/TEMPLATE_ADB_SERVICE/${adbService}/`;
  try {
    let { exitCode, stderr } = await $`sed '${replaceCmdAdbPassword}' \
          env_server_template \
          | sed '${replaceCmdAdbService}' \
          > .env_server`;
    if (exitCode !== 0) {
      exitWithError(`Error creating .env_server: ${stderr}`);
    }
    console.log(`Overlay ${chalk.green(".env_server")} created.`);
  } catch (error) {
    exitWithError(error.stderr);
  } finally {
    await cd(pwdOutput);
  }
}

async function createScoreConfigFile(adbAdminPassword, adbService) {
  const pwdOutput = (await $`pwd`).stdout.trim();
  await cd("./deploy/k8s/base/score/");
  const replaceCmdAdbPassword = `s/TEMPLATE_ADB_PASSWORD/${adbAdminPassword}/`;
  const replaceCmdAdbService = `s/TEMPLATE_ADB_SERVICE/${adbService}_high/`;
  try {
    let { exitCode, stderr } =
      await $`sed '${replaceCmdAdbPassword}' application.properties.template \
            | sed '${replaceCmdAdbService}' > application.properties`;
    if (exitCode !== 0) {
      exitWithError(`Error creating application.properties: ${stderr}`);
    }
    console.log(`Overlay ${chalk.green("application.properties")} created.`);
  } catch (error) {
    exitWithError(error.stderr);
  } finally {
    await cd(pwdOutput);
  }
}

async function createReplayConfigFile(adbAdminPassword, adbService) {
  const pwdOutput = (await $`pwd`).stdout.trim();
  await cd("./deploy/k8s/base/replay/");
  const replaceCmdAdbPassword = `s/TEMPLATE_ADB_PASSWORD/${adbAdminPassword}/`;
  const replaceCmdAdbService = `s/TEMPLATE_ADB_SERVICE/${adbService}_high/`;
  try {
    let { exitCode, stderr } =
      await $`sed '${replaceCmdAdbPassword}' application.properties.template \
            | sed '${replaceCmdAdbService}' > application.properties`;
    if (exitCode !== 0) {
      exitWithError(`Error creating application.properties (replay): ${stderr}`);
    }
    console.log(`Overlay ${chalk.green("replay/application.properties")} created.`);
  } catch (error) {
    exitWithError(error.stderr);
  } finally {
    await cd(pwdOutput);
  }
}

async function createPrivateAgentFactoryConfigFile(adbAdminPassword, adbService, adbWalletPassword) {
  const pwdOutput = (await $`pwd`).stdout.trim();
  await cd("./deploy/k8s/base/private-agent-factory/");
  try {
    const replacements = {
      TEMPLATE_ADB_PASSWORD: adbAdminPassword,
      TEMPLATE_ADB_WALLET_PASSWORD: adbWalletPassword,
      TEMPLATE_ADB_SERVICE: adbService,
      TEMPLATE_OCI_REGION: process.env.OCI_REGION || "",
      TEMPLATE_COMPARTMENT_OCID: process.env.OCI_COMPARTMENT_OCID || "",
      TEMPLATE_GENAI_MODEL_ID: process.env.OCI_GENAI_MODEL_ID || "cohere.command-r-08-2024",
      TEMPLATE_PAF_MCP_ENABLED: process.env.PAF_MCP_ENABLED || "true",
      TEMPLATE_PAF_MCP_PUBLIC_URL: process.env.PAF_MCP_PUBLIC_URL || "",
      TEMPLATE_PAF_CANVAS_RUN_ENDPOINT_URL: process.env.PAF_CANVAS_RUN_ENDPOINT_URL || "",
      TEMPLATE_PAF_CANVAS_ROOM_ID: process.env.PAF_CANVAS_ROOM_ID || "",
      TEMPLATE_PAF_CANVAS_TIMEOUT_MS: process.env.PAF_CANVAS_TIMEOUT_MS || "3000",
      TEMPLATE_PAF_COMMENTARY_DEADLINE_MS: process.env.PAF_COMMENTARY_DEADLINE_MS || "30000",
      TEMPLATE_PAF_CANVAS_RETURN_RESERVE_MS: process.env.PAF_CANVAS_RETURN_RESERVE_MS || "1000",
      TEMPLATE_PAF_CANVAS_MIN_TIMEOUT_MS: process.env.PAF_CANVAS_MIN_TIMEOUT_MS || "250",
      TEMPLATE_PAF_CANVAS_VERIFY_TLS: process.env.PAF_CANVAS_VERIFY_TLS || "false",
      TEMPLATE_PAF_MODEL_ROUTE_MODE: process.env.PAF_MODEL_ROUTE_MODE || "shadow",
      TEMPLATE_PAF_PRIMARY_MODEL_PROVIDER: process.env.PAF_PRIMARY_MODEL_PROVIDER || "oci-base",
      TEMPLATE_PAF_CANDIDATE_MODEL_PROVIDER: process.env.PAF_CANDIDATE_MODEL_PROVIDER || "oci-fine-tuned",
      TEMPLATE_OCI_BASE_MODEL_ENDPOINT_URL: process.env.OCI_BASE_MODEL_ENDPOINT_URL || "http://stwl-base-commentary:8080",
      TEMPLATE_OCI_FT_MODEL_ENDPOINT_URL: process.env.OCI_FT_MODEL_ENDPOINT_URL || "http://stwl-ft-commentary:8080",
      TEMPLATE_OCI_MODEL_ENDPOINT_TIMEOUT_MS: process.env.OCI_MODEL_ENDPOINT_TIMEOUT_MS || "12000",
      TEMPLATE_OCI_MODEL_ENDPOINT_VERIFY_TLS: process.env.OCI_MODEL_ENDPOINT_VERIFY_TLS || "true",
      TEMPLATE_PAF_TRACE_PERSIST: process.env.PAF_TRACE_PERSIST || "true",
      TEMPLATE_PAF_EVAL_ENABLED: process.env.PAF_EVAL_ENABLED || "true",
      TEMPLATE_PAF_MODEL_FAST_PATH_ENABLED: process.env.PAF_MODEL_FAST_PATH_ENABLED || "false",
      TEMPLATE_PAF_EVAL_RUBRIC_VERSION: process.env.PAF_EVAL_RUBRIC_VERSION || "stwl-commentary-v1",
      TEMPLATE_PAF_TRAINING_CAPTURE_ENABLED: process.env.PAF_TRAINING_CAPTURE_ENABLED || "true",
    };
    let content = await fs.readFile("application.env.template", "utf8");
    for (const [placeholder, value] of Object.entries(replacements)) {
      content = content.split(placeholder).join(String(value ?? ""));
    }
    await fs.writeFile("application.env", content, "utf8");
    console.log(`Overlay ${chalk.green("private-agent-factory/application.env")} created.`);
  } catch (error) {
    exitWithError(error.stderr || error.message);
  } finally {
    await cd(pwdOutput);
  }
}

async function createCerts() {
  console.log("Generate Self signed certs...");

  const certPath = "./deploy/k8s/base/ingress/.certs";
  const prevKeyExists = await fs.pathExists(path.join(certPath, "tls.key"));
  if (prevKeyExists) {
    console.log(
      `${chalk.yellow("Existing key pair ")} on ${certPath}. ${chalk.red(
        "Key pair not generated"
      )}.`
    );
  } else {
    await createSelfSignedCert(certPath);
  }
  console.log();
}
