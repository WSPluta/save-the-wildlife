#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TF_ENV = path.join("deploy", "devops", "tf-env");

function argValue(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${command} exited ${result.status}`);
  }
  return result.stdout.trim();
}

function terraformOutput(tfDir) {
  const text = run("terraform", ["-chdir=" + tfDir, "output", "-json"]);
  return JSON.parse(text || "{}");
}

async function keyContent(keyFile) {
  const resolved = path.resolve(keyFile);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`${resolved} is not a file`);
  const content = await fs.readFile(resolved, "utf8");
  if (!content.includes("PRIVATE KEY")) {
    throw new Error(`${resolved} does not look like a private key`);
  }
  return { resolved, content };
}

async function main() {
  const keyFile = argValue("key-file", process.env.PAF_CANVAS_SSH_KEY_FILE || "");
  if (!keyFile) {
    throw new Error("Missing --key-file or PAF_CANVAS_SSH_KEY_FILE.");
  }
  const tfEnv = argValue("tf-env", DEFAULT_TF_ENV);
  const secretName = argValue("secret-name", process.env.PAF_CANVAS_SSH_SECRET_NAME || "paf_canvas_ssh_key");
  const compartmentId = argValue("compartment-id", process.env.COMPARTMENT_OCID || "");
  const dryRun = hasFlag("dry-run");
  const outputs = terraformOutput(tfEnv);
  const vaultId = argValue("vault-id", process.env.PAF_CANVAS_VAULT_ID || outputs.devops_vault_id?.value || "");
  const keyId = argValue("key-id", process.env.PAF_CANVAS_VAULT_KEY_ID || outputs.devops_vault_key_id?.value || "");
  const finalCompartmentId = compartmentId || outputs.compartment_id?.value || "";
  const { resolved, content } = await keyContent(keyFile);
  const encoded = Buffer.from(content, "utf8").toString("base64");

  const missing = [];
  if (!vaultId) missing.push("vault-id/devops_vault_id");
  if (!keyId) missing.push("key-id/devops_vault_key_id");
  if (!finalCompartmentId) missing.push("compartment-id/compartment_id");
  if (missing.length) {
    throw new Error(`Missing required value(s): ${missing.join(", ")}. Run terraform apply in ${tfEnv} after adding the new outputs.`);
  }

  console.log(`# key_file=${resolved}`);
  console.log(`# secret_name=${secretName}`);
  console.log(`# vault_id=${vaultId}`);
  console.log(`# key_id=${keyId}`);
  console.log(`# compartment_id=${finalCompartmentId}`);
  if (dryRun) {
    console.log("# dry-run: secret not created");
    return;
  }

  const result = run("oci", [
    "vault",
    "secret",
    "create-base64",
    "--compartment-id", finalCompartmentId,
    "--vault-id", vaultId,
    "--key-id", keyId,
    "--secret-name", secretName,
    "--description", "Save the Wildlife PAF Canvas SSH private key for automated flow import.",
    "--secret-content-content", encoded,
    "--secret-content-name", `${secretName}_content`,
    "--secret-content-stage", "CURRENT",
  ]);
  const created = JSON.parse(result || "{}");
  const secretId = created.data?.id || "";
  if (!secretId) throw new Error("OCI did not return a secret OCID.");
  console.log(`export PAF_CANVAS_SSH_KEY_SECRET_ID='${secretId}'`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
