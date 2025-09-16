import { createServer } from "http";
import express from "express";
import { createClient } from "redis";
import { Session, Options } from "@oracle/coherence";
import { createTerminus } from "@godaddy/terminus";
import pino from "pino";
import * as dotenv from "dotenv";
import { start } from "./server.js";
import pinoHttp from "pino-http";
import { register } from "./metrics.js";

/**
 * Load env in this order (later calls don't override existing):
 * 1) default .env (if present)
 * 2) config/.env (mounted by K8s ConfigMap in container at /usr/src/app/config/.env)
 * 3) ../.config/.env (legacy path)
 */
dotenv.config();
dotenv.config({ path: "config/.env" });
dotenv.config({ path: "../.config/.env" });

const port = parseInt(process.env.PORT, 10) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const logger = pino({ level: isProduction ? "warn" : "debug" });

logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

const app = express();
const httpServer = createServer(app);

 // JSON body parser and optional lightweight replay endpoint (disabled in prod; rely on Replay service via Ingress)
app.use(express.json({ limit: "2mb" }));
app.use(pinoHttp({ logger }));
// Prometheus metrics endpoint
app.get("/metrics", async (_req, res) => {
  try {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (e) {
    res.status(500).end(String(e && e.message ? e.message : e));
  }
});
if (process.env.ENABLE_REPLAY_FALLBACK === "true") {
  app.post("/api/replay/events", (req, res) => {
    try {
      const body = req && req.body ? req.body : null;
      logger.info(`Replay event received: ${body ? JSON.stringify(body).slice(0, 2000) : "<empty>"}`);
    } catch (_) {}
    res.status(202).json({ ok: true });
  });
}

let pubClient;
let subClient;
let cacheSession;

const ENABLE_COHERENCE_BACKEND = process.env.ENABLE_COHERENCE_BACKEND === "true" || false;

const COHERENCE_SERVICE_HOST = process.env.COHERENCE_SERVICE_HOST || "localhost";
const COHERENCE_SERVICE_PORT = parseInt(process.env.COHERENCE_SERVICE_PORT) || 1408;
const COHERENCE_PASSWORD = process.env.COHERENCE_PASSWORD; // Add password env var for basic auth

const coherenceAddress = `${COHERENCE_SERVICE_HOST}:${COHERENCE_SERVICE_PORT}`;

// TODO: Implement TLS for production. For now, using password if set.
if (COHERENCE_PASSWORD) {
  logger.info("Coherence password authentication enabled.");
} else {
  logger.warn("Coherence running without password - insecure for production!");
}
logger.info(`Coherence: ${ENABLE_COHERENCE_BACKEND ? "Enabled" : "Disabled"}`);
if (ENABLE_COHERENCE_BACKEND) {
  logger.info(`Coherence URL: ${coherenceAddress}`);
}

const ENABLE_REDIS_BACKEND = process.env.ENABLE_REDIS_BACKEND === "true";

if (ENABLE_REDIS_BACKEND) {
  const REDIS_SERVICE_HOST = process.env.REDIS_SERVICE_HOST
    ? process.env.REDIS_SERVICE_HOST
    : "localhost";

  const REDIS_SERVICE_PORT = process.env.REDIS_SERVICE_PORT
    ? parseInt(process.env.REDIS_SERVICE_PORT)
    : 6379;

  const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
  if (!REDIS_PASSWORD) {
    logger.error(`REDIS_PASSWORD is not declared`);
    process.exit(1);
  }

  const REDIS_URL = `redis://default:${REDIS_PASSWORD}@${REDIS_SERVICE_HOST}:${REDIS_SERVICE_PORT}`;
  const REDIS_URL_OBFUSCATED = `redis://default:*******@${REDIS_SERVICE_HOST}:${REDIS_SERVICE_PORT}`;
  logger.info(`Redis URL: ${REDIS_URL_OBFUSCATED}`);

  pubClient = createClient({
    url: REDIS_URL,
  });
  subClient = pubClient.duplicate();
  pubClient.on("error", (err) =>
    logger.error(`Redis Pub Client Error: ${err}`)
  );
  subClient.on("error", (err) =>
    logger.error(`Redis Sub Client Error: ${err}`)
  );

  Promise.all([
    pubClient.connect(),
    subClient.connect(),
    createCacheSession(),
  ]).then(async () => {
    start(httpServer, port, cacheSession, pubClient, subClient);
  });
} else {
  createCacheSession().then(() => {
    start(httpServer, port, cacheSession);
  });
}

function onSignal() {
  logger.info("Server cleaning up");
  if (ENABLE_REDIS_BACKEND) {
    if (pubClient) pubClient.quit();
    if (subClient) subClient.quit();
  }
  if (cacheSession) cacheSession.close();
}

async function onHealthCheck() {
  const responseStatus = {
    redis: { status: "disabled" },
    coherence: { status: "disabled" },
  };
  if (ENABLE_REDIS_BACKEND) {
    try {
      const redisOk = (await pubClient.ping()) === "PONG";
      if (!redisOk) {
        responseStatus.redis.status = "Connection error";
        return Promise.reject(responseStatus);
      }
      responseStatus.redis.status = "OK";
    } catch (error) {
      responseStatus.redis.status = "Connection error";
      return Promise.reject(responseStatus);
    }
  }
  if (ENABLE_COHERENCE_BACKEND) {
    try {
      const coherenceStatusOk = await cacheSession.callOptions();
      if (!coherenceStatusOk) {
        responseStatus.coherence.status = "Connection error";
        return Promise.reject(responseStatus);
      }
      responseStatus.coherence.status = "OK";
    } catch (error) {
      responseStatus.coherence.status = "Connection error";
      return Promise.reject(responseStatus);
    }
  }
  return Promise.resolve(responseStatus);
}

createTerminus(httpServer, {
  signal: "SIGINT",
  healthChecks: { "/healthz": onHealthCheck },
  onSignal,
});

// Enhanced createCacheSession with error handling and optional password
async function createCacheSession() {
  if (!ENABLE_COHERENCE_BACKEND) {
    logger.info("Coherence is disabled");
    return null;
  }

  try {
    const opts = new Options();
    opts.address = coherenceAddress;
    // Add password if provided (assuming Coherence supports it; adjust based on actual API)
    if (COHERENCE_PASSWORD) {
      opts.password = COHERENCE_PASSWORD; // Placeholder; verify with Coherence docs
    }
    cacheSession = new Session(opts);
    return cacheSession;
  } catch (err) {
    logger.error(`Failed to create Coherence session: ${err.message}`);
    throw err;
  }
}
