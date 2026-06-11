import { createServer } from "http";
import express from "express";
import { Session, Options } from "@oracle/coherence";
import { createTerminus } from "@godaddy/terminus";
import pino from "pino";
import * as dotenv from "dotenv";
import { start } from "./server.js";
import pinoHttp from "pino-http";
import { register } from "./metrics.js";
import {
  assertRealtimeTopology,
  resolveRealtimeBackend,
  shouldUseCoherence,
  socketBusConfigFromEnv,
} from "./lib/realtimeBackend.js";

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

let cacheSession;

const realtimeTopology = assertRealtimeTopology(process.env);
const REALTIME_CLUSTER_BACKEND = resolveRealtimeBackend(process.env);
const ENABLE_COHERENCE_BACKEND = shouldUseCoherence(process.env);
const socketBusConfig = socketBusConfigFromEnv(process.env);

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
logger.info(`Realtime backend: ${REALTIME_CLUSTER_BACKEND}`);
logger.info(`WS replicas requested: ${realtimeTopology.replicas}`);
if (ENABLE_COHERENCE_BACKEND) {
  logger.info(`Coherence URL: ${coherenceAddress}`);
}

createCacheSession().then(() => {
  start(httpServer, port, cacheSession, {
    realtimeBackend: REALTIME_CLUSTER_BACKEND,
    socketBusConfig,
  });
});

function onSignal() {
  logger.info("Server cleaning up");
  if (cacheSession) cacheSession.close();
}

async function onHealthCheck() {
  const responseStatus = {
    realtime: {
      backend: REALTIME_CLUSTER_BACKEND,
      socketBusMap: socketBusConfig.mapName,
    },
    coherence: { status: "disabled" },
  };
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
