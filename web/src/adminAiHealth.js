function formatHealthCountMap(counts = {}) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return "-";
  return entries.map(([key, value]) => `${key}:${value}`).join(", ");
}

function isAdapterUnavailable(adapter) {
  if (!adapter) return true;
  if (adapter.generation_ready === false) return true;
  if (adapter.ok === false) return true;
  if (adapter.error) return true;
  if (!adapter.runtime_mode || adapter.runtime_mode === "missing") return true;
  return false;
}

export function summarizeAiAdapterHealth(health = {}) {
  const adapters = Array.isArray(health.model_adapters) ? health.model_adapters : [];
  const summary = health.model_adapter_summary || {};
  const generationProbeKnown = adapters.some((adapter) => Object.prototype.hasOwnProperty.call(adapter || {}, "generation_ready"))
    || Object.prototype.hasOwnProperty.call(summary, "generation_ready");
  const readyProviders = adapters
    .filter((adapter) => adapter && adapter.generation_ready === true)
    .map((adapter) => adapter.provider || "unknown");
  const degradedProviders = adapters
    .filter((adapter) => adapter && adapter.generation_ready !== true && isAdapterUnavailable(adapter))
    .map((adapter) => adapter.provider || "unknown");
  const generationReady = summary.generation_ready === true || (
    generationProbeKnown &&
    adapters.length > 0 &&
    adapters.every((adapter) => adapter && adapter.generation_ready === true)
  );
  const generationDegraded = readyProviders.length > 0 && degradedProviders.length > 0;
  const ready = !generationDegraded && (
    (summary.upstream_llm_ready === true && (summary.generation_ready !== false)) || (
      adapters.length > 0 &&
      adapters.every((adapter) =>
        adapter &&
        adapter.ok === true &&
        adapter.runtime_mode === "upstream-llm" &&
        (!generationProbeKnown || adapter.generation_ready === true)
      )
    )
  );
  const runtimes = summary.runtime_counts || adapters.reduce((acc, adapter) => {
    const provider = adapter?.provider || "unknown";
    const runtime = adapter?.runtime_mode || "missing";
    acc[`${provider}:${runtime}`] = (acc[`${provider}:${runtime}`] || 0) + 1;
    return acc;
  }, {});
  const formats = summary.upstream_format_counts || adapters.reduce((acc, adapter) => {
    const format = adapter?.upstream_format || "missing";
    acc[format] = (acc[format] || 0) + 1;
    return acc;
  }, {});
  const degradedRuntimeText = generationDegraded
    ? `${readyProviders.join(", ")} ready; ${degradedProviders.join(", ")} degraded`
    : formatHealthCountMap(runtimes);
  return {
    ready,
    degraded: generationDegraded,
    runtimeText: ready ? "upstream-llm" : degradedRuntimeText,
    handoffText: `upstream formats ${formatHealthCountMap(formats)}`,
    gateText: ready ? "Ready" : (generationDegraded ? "Base ready; candidate degraded" : (generationProbeKnown && !generationReady ? "Generation check failed" : "Check route")),
    verdictText: ready ? "Generation ready" : (generationDegraded ? "Base ready" : (generationProbeKnown ? "Generation not proven" : "Route configured")),
  };
}
