import * as dotenv from "dotenv";
import fetch from "node-fetch";
import pino from "pino";

dotenv.config({ path: "../.config/.env" });
const isProduction = process.env.NODE_ENV === "production";
const logger = pino({ level: isProduction ? "warn" : "debug" });

let scoreFeatureFlag = true;
let scoreServiceBaseUrl;

const SCORE_SERVICE_BASE_URL = process.env.SCORE_SERVICE_BASE_URL;
const SCORE_SERVICE_HOST = process.env.SCORE_SERVICE_HOST;
const SCORE_SERVICE_PORT = process.env.SCORE_SERVICE_PORT;

function ensureScheme(url) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url.replace(/\/+$/, "");
  return `http://${url}`.replace(/\/+$/, "");
}

if (SCORE_SERVICE_BASE_URL) {
  scoreServiceBaseUrl = ensureScheme(SCORE_SERVICE_BASE_URL);
} else if (SCORE_SERVICE_HOST && SCORE_SERVICE_PORT) {
  scoreServiceBaseUrl = ensureScheme(`${SCORE_SERVICE_HOST}:${SCORE_SERVICE_PORT}`);
} else {
  logger.error("SCORE_SERVICE_BASE_URL or SCORE_SERVICE_HOST/SCORE_SERVICE_PORT not defined");
  scoreFeatureFlag = false;
}

if (scoreFeatureFlag) {
  logger.info({ scoreServiceBaseUrl });
  logger.info(`Connecting to Score on ${scoreServiceBaseUrl}`);
}

export async function postCurrentScore(playerId, playerName, operationType) {
  if (!scoreFeatureFlag) return;
  const urlRequest = `${scoreServiceBaseUrl}/api/score/${playerId}`;
  try {
    const stringifyBody = JSON.stringify({
      operationType: operationType,
      name: playerName,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(urlRequest, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: stringifyBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch (_) {}
      logger.error({
        url: urlRequest,
        status: response.status,
        body: bodyText ? bodyText.slice(0, 1000) : ""
      }, "postCurrentScore non-OK response");
      throw new Error(`HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch (_) {
      // Unexpected content-type; return raw text to aid debugging
      const txt = await response.text().catch(() => "");
      return { ok: true, raw: txt };
    }
  } catch (error) {
    logger.error({
      err: error && error.message ? error.message : String(error),
      url: urlRequest,
      base: scoreServiceBaseUrl
    }, "Error in postCurrentScore");
    return { score: 0 };
  }
}

export async function deleteCurrentScore(playerId) {
  if (!scoreFeatureFlag) return;
  const urlRequest = `${scoreServiceBaseUrl}/api/score/${playerId}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(urlRequest, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch (_) {}
      logger.error({
        url: urlRequest,
        status: response.status,
        body: bodyText ? bodyText.slice(0, 1000) : ""
      }, "deleteCurrentScore non-OK response");
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    logger.error({
      err: error && error.message ? error.message : String(error),
      url: urlRequest,
      base: scoreServiceBaseUrl
    }, "Error in deleteCurrentScore");
  }
}
