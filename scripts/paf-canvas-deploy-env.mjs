#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://130.162.174.167";
const DEFAULT_TFVARS = path.join("deploy", "devops", "tf-devops", "terraform.tfvars");

function argValue(name, fallback) {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "'\\''")}'`;
}

async function readTfvars(filePath) {
  const values = {};
  try {
    const text = await fs.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"(.*)"\s*$/);
      if (match) values[match[1]] = match[2];
    }
  } catch (_) {
    return values;
  }
  return values;
}

function readTerraformOutput(tfDir) {
  try {
    const result = spawnSync("terraform", ["-chdir=" + tfDir, "output", "-json"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (result.status !== 0) return {};
    return JSON.parse(result.stdout || "{}");
  } catch (_) {
    return {};
  }
}

function hostFromCanvasEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname;
  } catch (_) {
    return "";
  }
}

function deriveBaseUrl(value) {
  const trimmed = String(value || "").replace(/\/+$/, "");
  return trimmed || DEFAULT_BASE_URL;
}

async function main() {
  const tfvarsPath = argValue("tfvars", DEFAULT_TFVARS);
  const tfEnvDir = argValue("tf-env", path.join("deploy", "devops", "tf-env"));
  const tfvars = await readTfvars(tfvarsPath);
  const tfEnvOutput = readTerraformOutput(tfEnvDir);
  const baseUrl = deriveBaseUrl(argValue("base-url", process.env.STWL_BASE_URL || DEFAULT_BASE_URL));
  const oldCanvasEndpoint = tfvars.paf_canvas_run_endpoint_url || process.env.PAF_CANVAS_RUN_ENDPOINT_URL || "";
  const suggestedCanvasHost = hostFromCanvasEndpoint(oldCanvasEndpoint);
  const terraformCanvasHost = tfEnvOutput.paf_canvas_public_ip?.value || "";
  const values = {
    PAF_CANVAS_ENABLED: process.env.PAF_CANVAS_ENABLED || "",
    PAF_CANVAS_USE_MARKETPLACE_IMAGE: process.env.PAF_CANVAS_USE_MARKETPLACE_IMAGE || "true",
    PAF_CANVAS_ACCEPT_MARKETPLACE_TERMS: process.env.PAF_CANVAS_ACCEPT_MARKETPLACE_TERMS || "true",
    PAF_CANVAS_IMAGE_OCID: process.env.PAF_CANVAS_IMAGE_OCID || "",
    PAF_CANVAS_INSTALL_SCRIPT_URL: process.env.PAF_CANVAS_INSTALL_SCRIPT_URL || "",
    PAF_CANVAS_CONTAINER_IMAGE_URI: process.env.PAF_CANVAS_CONTAINER_IMAGE_URI || "",
    PAF_MCP_ENABLED: process.env.PAF_MCP_ENABLED || tfvars.paf_mcp_enabled || "true",
    PAF_MCP_PUBLIC_URL: process.env.PAF_MCP_PUBLIC_URL || tfvars.paf_mcp_public_url || `${baseUrl}/paf/mcp`,
    PAF_CANVAS_IMPORT_ENABLED: process.env.PAF_CANVAS_IMPORT_ENABLED || tfvars.paf_canvas_import_enabled || "true",
    PAF_CANVAS_HOST: process.env.PAF_CANVAS_HOST || tfvars.paf_canvas_host || terraformCanvasHost || suggestedCanvasHost,
    PAF_CANVAS_SSH_USER: process.env.PAF_CANVAS_SSH_USER || tfvars.paf_canvas_ssh_user || "opc",
    PAF_CANVAS_SSH_KEY_SECRET_ID: process.env.PAF_CANVAS_SSH_KEY_SECRET_ID || tfvars.paf_canvas_ssh_key_secret_id || "",
    PAF_CANVAS_FLOW_NAME: process.env.PAF_CANVAS_FLOW_NAME || tfvars.paf_canvas_flow_name || "Save the Wildlife Commentator",
    PAF_CANVAS_AGENT_FACTORY_USER: process.env.PAF_CANVAS_AGENT_FACTORY_USER || tfvars.paf_canvas_agent_factory_user || "",
    PAF_CANVAS_LLM_CONFIG_NAME: process.env.PAF_CANVAS_LLM_CONFIG_NAME || tfvars.paf_canvas_llm_config_name || "llm_model_entry",
    PAF_CANVAS_REQUIRE_LLM_CONFIG: process.env.PAF_CANVAS_REQUIRE_LLM_CONFIG || tfvars.paf_canvas_require_llm_config || "false",
  };
  const missing = [];
  if (values.PAF_CANVAS_IMPORT_ENABLED === "true" && !values.PAF_CANVAS_HOST) missing.push("PAF_CANVAS_HOST");
  if (values.PAF_CANVAS_IMPORT_ENABLED === "true" && !values.PAF_CANVAS_SSH_KEY_SECRET_ID) missing.push("PAF_CANVAS_SSH_KEY_SECRET_ID");
  if (values.PAF_CANVAS_IMPORT_ENABLED === "true" && !values.PAF_MCP_PUBLIC_URL) missing.push("PAF_MCP_PUBLIC_URL");
  const wantsTerraformCanvas = values.PAF_CANVAS_ENABLED === "true";
  if (
    wantsTerraformCanvas &&
    values.PAF_CANVAS_USE_MARKETPLACE_IMAGE !== "true" &&
    !values.PAF_CANVAS_IMAGE_OCID &&
    !values.PAF_CANVAS_INSTALL_SCRIPT_URL &&
    !values.PAF_CANVAS_CONTAINER_IMAGE_URI
  ) {
    missing.push("PAF_CANVAS_USE_MARKETPLACE_IMAGE=true or PAF_CANVAS_IMAGE_OCID or PAF_CANVAS_INSTALL_SCRIPT_URL or PAF_CANVAS_CONTAINER_IMAGE_URI");
  }

  console.log("# Save the Wildlife PAF Canvas + MCP deploy environment");
  console.log(`# source tfvars: ${tfvarsPath}`);
  console.log(`# source tf-env: ${tfEnvDir}`);
  console.log(`# base URL: ${baseUrl}`);
  if (terraformCanvasHost) console.log(`# Terraform PAF Canvas host: ${terraformCanvasHost}`);
  if (oldCanvasEndpoint) console.log(`# previous Canvas run endpoint: ${oldCanvasEndpoint}`);
  console.log("");
  for (const [key, value] of Object.entries(values)) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
  console.log("");
  console.log("# Then run:");
  console.log("# For a brand-new Terraform-managed Canvas host first run:");
  console.log("npx zx scripts/tfvars.mjs env");
  console.log("terraform -chdir=deploy/devops/tf-env apply -auto-approve");
  console.log("# Then create/import the Canvas SSH secret if needed:");
  console.log("npm run create:paf-canvas-ssh-secret -- --key-file <paf-canvas-private-key>");
  console.log("npx zx scripts/tfvars.mjs devops");
  console.log("terraform -chdir=deploy/devops/tf-devops apply -auto-approve");
  console.log("# Trigger the OCI DevOps build/deploy pipeline, then verify:");
  console.log("npm run check:paf-canvas-mcp");
  if (missing.length) {
    console.error(`\nMissing required value(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
