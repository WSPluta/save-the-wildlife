#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getOracleConnection } from "../index.js";

function parseArgs(argv = process.argv.slice(2)) {
  const config = {
    output: "",
    datasetVersion: process.env.PAF_TRAINING_DATASET_VERSION || "",
    runId: process.env.STWL_LOAD_RUN_ID || "",
    roomId: "",
    includeRejected: false,
    limit: 1000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || "";
    if (arg === "--output" || arg === "-o") config.output = next();
    else if (arg === "--dataset-version") config.datasetVersion = next();
    else if (arg === "--run-id") config.runId = next();
    else if (arg === "--room-id" || arg === "--room") config.roomId = next();
    else if (arg === "--include-rejected") config.includeRejected = true;
    else if (arg === "--limit") config.limit = Number(next());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/export-training-examples.mjs [options]

Options:
  --output, -o <path>         Write JSONL to a file instead of stdout
  --dataset-version <value>   Filter STWL_TRAINING_EXAMPLES.dataset_version
  --run-id <value>            Filter STWL_MODEL_TRACES.run_id
  --room-id <value>           Filter STWL_MODEL_TRACES.room_id
  --include-rejected          Include rejected examples; default exports accepted only
  --limit <n>                 Maximum rows, default 1000
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  config.limit = Math.max(1, Math.min(10000, Number.isFinite(config.limit) ? Math.floor(config.limit) : 1000));
  return config;
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function buildCitations(row, exampleJson = {}) {
  const citations = Array.isArray(exampleJson.citations) ? exampleJson.citations.map(String) : [];
  if (row.SESSION_ID && row.PLAYER_ID) citations.push(`STWL_GAME_EVENTS:${row.SESSION_ID}:${row.PLAYER_ID}`);
  if (row.TRACE_ID) citations.push(`STWL_MODEL_TRACES:${row.TRACE_ID}`);
  if (row.TRACE_ID && row.RUBRIC_VERSION) citations.push(`STWL_MODEL_EVALS:${row.TRACE_ID}:${row.RUBRIC_VERSION}`);
  return [...new Set(citations.filter(Boolean))];
}

function rowToTrainingRecord(row) {
  const exampleJson = parseJson(row.EXAMPLE_JSON, {});
  const scores = parseJson(row.SCORES_JSON, {});
  const outputText = text(row.OUTPUT_TEXT) || text(exampleJson.text);
  return {
    trace_id: text(row.TRACE_ID),
    session_id: text(row.SESSION_ID),
    room_id: text(row.ROOM_ID),
    player_id: text(row.PLAYER_ID),
    run_id: text(row.RUN_ID),
    dataset_version: text(row.DATASET_VERSION),
    split: text(row.SPLIT),
    redaction_status: text(row.REDACTION_STATUS || "metadata-only"),
    prompt_hash: text(row.PROMPT_HASH || exampleJson.prompt_hash),
    evidence_hash: text(row.EVIDENCE_HASH || exampleJson.evidence_hash),
    prompt_text: text(row.PROMPT_TEXT),
    citations: buildCitations(row, exampleJson),
    provider: text(row.PROVIDER || exampleJson.provider),
    model_id: text(row.MODEL_ID || exampleJson.model_id),
    output_text: outputText,
    rubric_version: text(row.RUBRIC_VERSION),
    verdict: text(row.VERDICT),
    eval_scores: scores && typeof scores === "object" ? scores : {},
  };
}

async function fetchRows(connection, config) {
  const result = await connection.execute(
    `SELECT *
     FROM (
       SELECT
         x.example_id,
         x.trace_id,
         x.dataset_version,
         x.split,
         x.redaction_status,
         x.accepted,
         x.example_json,
         t.session_id,
         t.room_id,
         t.player_id,
         t.run_id,
         t.prompt_hash,
         t.evidence_hash,
         t.prompt_text,
         e.rubric_version,
         e.verdict,
         e.scores_json,
         o.provider,
         o.model_id,
         o.output_text,
         x.created_at
       FROM STWL_TRAINING_EXAMPLES x
       JOIN STWL_MODEL_TRACES t ON t.trace_id = x.trace_id
       LEFT JOIN STWL_MODEL_EVALS e ON e.trace_id = x.trace_id
       LEFT JOIN STWL_MODEL_OUTPUTS o ON o.trace_id = x.trace_id AND o.is_candidate = 1
       WHERE (:include_rejected = 1 OR x.accepted = 1)
         AND (:dataset_version IS NULL OR x.dataset_version = :dataset_version)
         AND (:run_id IS NULL OR t.run_id = :run_id)
         AND (:room_id IS NULL OR t.room_id = :room_id)
       ORDER BY x.created_at DESC
     )
     WHERE ROWNUM <= :limit`,
    {
      include_rejected: config.includeRejected ? 1 : 0,
      dataset_version: config.datasetVersion || null,
      run_id: config.runId || null,
      room_id: config.roomId || null,
      limit: config.limit,
    }
  );
  return result.rows || [];
}

async function main() {
  const config = parseArgs();
  const oracle = await getOracleConnection();
  if (!oracle) {
    throw new Error("Oracle connection is not configured; set ORACLE_USER, ORACLE_PASSWORD, and ORACLE_CONNECT_STRING.");
  }
  const { connection, close } = oracle;
  try {
    const rows = await fetchRows(connection, config);
    const records = rows.map(rowToTrainingRecord).filter((row) => row.output_text);
    const jsonl = records.map((row) => JSON.stringify(row)).join("\n") + (records.length ? "\n" : "");
    if (config.output) {
      writeFileSync(config.output, jsonl, "utf8");
      console.error(`exported ${records.length} training examples to ${config.output}`);
    } else {
      process.stdout.write(jsonl);
    }
  } finally {
    if (close) await connection.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

export {
  buildCitations,
  parseArgs,
  rowToTrainingRecord,
};
