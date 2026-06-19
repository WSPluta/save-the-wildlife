function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fallbackValue(fallback) {
  return typeof fallback === "function" ? fallback() : {};
}

function warn(logger, details, message) {
  if (!logger || typeof logger.warn !== "function") return;
  logger.warn(details, message);
}

async function scanEntries(cache) {
  const response = await cache.entries();
  const data = {};
  for await (const entry of response) {
    data[entry.key] = entry.value;
  }
  return data;
}

export function createCoherenceEntryReader(options = {}) {
  const timeoutMs = positiveInteger(options.timeoutMs, 2500);
  const backoffMs = positiveInteger(options.backoffMs, 60000);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const logger = options.logger;
  const states = new WeakMap();

  return {
    async readEntries(cache, { fallback, label = "unknown" } = {}) {
      if (!cache || typeof cache.entries !== "function") {
        return fallbackValue(fallback);
      }

      const state = states.get(cache);
      const current = now();
      if (state && state.retryAfter > current) {
        return fallbackValue(fallback);
      }

      let timeoutId;
      const scanPromise = scanEntries(cache);
      scanPromise.catch(() => {});

      try {
        const result = timeoutMs > 0
          ? await Promise.race([
              scanPromise,
              new Promise((_, reject) => {
                timeoutId = setTimeout(
                  () => reject(new Error(`coherence_scan_timeout:${timeoutMs}`)),
                  timeoutMs
                );
              }),
            ])
          : await scanPromise;
        states.delete(cache);
        return result;
      } catch (error) {
        states.set(cache, {
          retryAfter: current + backoffMs,
          lastError: error?.message || String(error),
        });
        warn(
          logger,
          {
            cache: label,
            timeoutMs,
            backoffMs,
            err: {
              name: error?.name,
              message: error?.message || String(error),
              code: error?.code,
            },
          },
          "Coherence entry scan failed; using local fallback"
        );
        return fallbackValue(fallback);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },

    reset(cache) {
      if (cache) states.delete(cache);
    },
  };
}
