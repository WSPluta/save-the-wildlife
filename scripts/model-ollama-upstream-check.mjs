#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_FALLBACK_URL = "http://stwl-ollama-fallback:11434/api/chat";
const DEFAULT_BASE_MODEL = "llama3.2:1b";
const DEFAULT_FT_MODEL = "llama3.2:1b-stwl";

function argValue(name, fallback = "") {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function tagsUrlFor(chatUrl) {
  const url = new URL(chatUrl);
  url.pathname = url.pathname.replace(/\/api\/chat$/, "/api/tags");
  if (!url.pathname.endsWith("/api/tags")) url.pathname = "/api/tags";
  url.search = "";
  return url.toString();
}

function isFallbackUrl(value) {
  return normalizeUrl(value).includes("stwl-ollama-fallback");
}

function uniqueChecks(checks) {
  const seen = new Set();
  return checks.filter((check) => {
    const key = `${check.url}|${check.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function runKubectlCheck(check, timeoutSeconds, image) {
  const payload = JSON.stringify({
    model: check.model,
    stream: false,
    messages: [
      { role: "user", content: "Reply with exactly one word: ready" },
    ],
  });
  const podName = `stwl-ollama-check-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const script = [
    "set -eu",
    "echo __TAGS__",
    `curl -fsS --max-time ${timeoutSeconds} "$TAGS_URL"`,
    "echo",
    "echo __CHAT__",
    `curl -fsS --max-time ${timeoutSeconds} -H 'Content-Type: application/json' -d "$PAYLOAD" "$CHAT_URL"`,
  ].join("\n");
  const runResult = spawnSync("kubectl", [
    "run",
    podName,
    "--restart=Never",
    `--image=${image}`,
    "--env", `TAGS_URL=${tagsUrlFor(check.url)}`,
    "--env", `CHAT_URL=${check.url}`,
    "--env", `PAYLOAD=${payload}`,
    "--command",
    "--",
    "sh",
    "-lc",
    script,
  ], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (runResult.status !== 0) {
    return {
      ok: false,
      status: runResult.status,
      stdout: runResult.stdout || "",
      stderr: runResult.stderr || "",
    };
  }

  const deadline = Date.now() + ((timeoutSeconds + 45) * 1000);
  let phase = "";
  while (Date.now() < deadline) {
    const phaseResult = spawnSync("kubectl", [
      "get",
      "pod",
      podName,
      "-o",
      "jsonpath={.status.phase}",
    ], { encoding: "utf8", timeout: 10_000 });
    phase = String(phaseResult.stdout || "").trim();
    if (["Succeeded", "Failed"].includes(phase)) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  const logsResult = spawnSync("kubectl", ["logs", podName], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const deleteResult = spawnSync("kubectl", ["delete", "pod", podName, "--ignore-not-found"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const ok = phase === "Succeeded";
  return {
    ok,
    status: ok ? 0 : (phase === "Failed" ? 1 : 124),
    stdout: logsResult.stdout || "",
    stderr: [
      runResult.stderr,
      logsResult.stderr,
      deleteResult.stderr,
      phase && phase !== "Succeeded" ? `pod phase=${phase}` : "",
    ].filter(Boolean).join("\n"),
  };
}

async function checkLocal(check, timeoutMs) {
  const tags = await fetchJsonWithTimeout(tagsUrlFor(check.url), {}, timeoutMs);
  const response = await fetchJsonWithTimeout(check.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: check.model,
      stream: false,
      messages: [
        { role: "user", content: "Reply with exactly one word: ready" },
      ],
    }),
  }, timeoutMs);
  return {
    ok: true,
    tags,
    response,
  };
}

function modelTags(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return models.map((model) => String(model.name || model.model || "")).filter(Boolean);
}

function parseClusterOutput(stdout) {
  const [tagPart = "", chatPart = ""] = String(stdout || "").split("__CHAT__");
  const stripKubectlNoise = (text) => String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^pod ".+" deleted/.test(line.trim()))
    .join("\n")
    .trim();
  const tagsText = stripKubectlNoise(tagPart.replace(/^.*__TAGS__/s, ""));
  const chatText = stripKubectlNoise(chatPart);
  return {
    tags: tagsText ? JSON.parse(tagsText) : null,
    response: chatText ? JSON.parse(chatText) : null,
  };
}

async function main() {
  const mode = argValue("mode", process.env.MODEL_AI_UPSTREAM_CHECK_MODE || "local");
  const timeoutMs = Math.max(1000, Number(argValue("timeout-ms", process.env.MODEL_AI_UPSTREAM_CHECK_TIMEOUT_MS || "60000")));
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const checkImage = argValue("image", process.env.MODEL_AI_UPSTREAM_CHECK_IMAGE || "docker.io/curlimages/curl:8.11.1");
  const requirePrivate = hasFlag("require-private") || ["1", "true", "yes", "on"].includes(String(process.env.MODEL_AI_REQUIRE_PRIVATE_OLLAMA || "").toLowerCase());
  const checks = uniqueChecks([
    {
      role: "base",
      url: normalizeUrl(argValue("base-url", process.env.MODEL_AI_BASE_UPSTREAM_URL || DEFAULT_FALLBACK_URL)),
      model: argValue("base-model", process.env.MODEL_AI_BASE_UPSTREAM_MODEL_ID || DEFAULT_BASE_MODEL),
    },
    {
      role: "fine-tuned",
      url: normalizeUrl(argValue("ft-url", process.env.MODEL_AI_FT_UPSTREAM_URL || DEFAULT_FALLBACK_URL)),
      model: argValue("ft-model", process.env.MODEL_AI_FT_UPSTREAM_MODEL_ID || DEFAULT_FT_MODEL),
    },
  ]);

  const results = [];
  for (const check of checks) {
    const failures = [];
    if (!check.url) failures.push("missing upstream URL");
    if (requirePrivate && isFallbackUrl(check.url)) failures.push("fallback upstream is not allowed when private Ollama is required");
    if (failures.length) {
      results.push({ ...check, ok: false, failures });
      continue;
    }
    try {
      const raw = mode === "cluster"
        ? runKubectlCheck(check, timeoutSeconds, checkImage)
        : await checkLocal(check, timeoutMs);
      if (mode === "cluster" && !raw.ok) {
        results.push({
          ...check,
          ok: false,
          failures: [`kubectl check failed with status ${raw.status}`],
          stdout: raw.stdout.slice(0, 2000),
          stderr: raw.stderr.slice(0, 2000),
        });
        continue;
      }
      const parsed = mode === "cluster" ? parseClusterOutput(raw.stdout) : raw;
      const tags = modelTags(parsed.tags);
      const modelPresent = tags.some((name) => name === check.model || name.startsWith(`${check.model}:`));
      const responseText = parsed.response?.message?.content || parsed.response?.response || "";
      if (!modelPresent) failures.push(`model ${check.model} not present in /api/tags`);
      if (!String(responseText).trim()) failures.push("chat response was empty");
      results.push({
        ...check,
        ok: failures.length === 0,
        failures,
        tags,
        response_preview: String(responseText).trim().slice(0, 120),
      });
    } catch (error) {
      results.push({
        ...check,
        ok: false,
        failures: [error.message || String(error)],
      });
    }
    await sleep(100);
  }

  const ok = results.every((result) => result.ok);
  const payload = {
    ok,
    mode,
    require_private: requirePrivate,
    checked_at: new Date().toISOString(),
    results,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
