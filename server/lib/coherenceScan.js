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
  const lastResults = new WeakMap();

  function fallbackFor(cache, fallback) {
    if (cache && lastResults.has(cache)) {
      return lastResults.get(cache);
    }
    return fallbackValue(fallback);
  }

  function startScan(cache, label) {
    let timeoutId;
    const scanPromise = scanEntries(cache);
    scanPromise.catch(() => {});

    return (async () => {
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
        lastResults.set(cache, result);
        states.delete(cache);
        return { ok: true, result };
      } catch (error) {
        states.set(cache, {
          retryAfter: now() + backoffMs,
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
        return { ok: false, error };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    })();
  }

  return {
    async readEntries(cache, { fallback, label = "unknown" } = {}) {
      if (!cache || typeof cache.entries !== "function") {
        return fallbackValue(fallback);
      }

      const state = states.get(cache);
      const current = now();
      if (state && state.retryAfter > current) {
        return fallbackFor(cache, fallback);
      }
      if (state?.inFlight) {
        const outcome = await state.inFlight;
        return outcome.ok ? outcome.result : fallbackFor(cache, fallback);
      }

      const inFlight = startScan(cache, label);
      states.set(cache, { retryAfter: 0, inFlight });
      const outcome = await inFlight;
      return outcome.ok ? outcome.result : fallbackFor(cache, fallback);
    },

    reset(cache) {
      if (cache) {
        states.delete(cache);
        lastResults.delete(cache);
      }
    },
  };
}
