import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeAiAdapterHealth } from "../adminAiHealth.js";

const html = readFileSync("src/index.html", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const script = readFileSync("src/script.js", "utf8");
const adminAiHealth = readFileSync("src/adminAiHealth.js", "utf8");
const worker = readFileSync("src/commsWorker.js", "utf8");

function textContent(fragment) {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function leafTextUnits(block) {
  return Array.from(block.matchAll(/<(h3|th|td|span|strong|em|div)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g))
    .filter((match) => !/<(?:h3|th|td|span|strong|em|div)\b/i.test(match[2]))
    .map((match) => textContent(match[2]))
    .filter((text) => /[a-z]/i.test(text));
}

describe("admin load evaluation view", () => {
  it("adds canary evidence to the presenter admin UI", () => {
    expect(html).toContain('id="admin-load-evaluation"');
    expect(html).toContain("Load Gate Proof");
    expect(html).toContain("Tier 1000 pass");
    expect(script).toContain('path === "/admin/observability"');
    expect(script).toContain('path === "/admin/ai"');
    expect(script).toMatch(/const IS_AI_LEARNING_VIEW =/);
  });

  it("keeps the load proof compact and receipt-driven", () => {
    expect(html).toContain("High-score test table verified 1000/1000 rows");
    expect(html).toContain("No fallback accepted");
    expect(html).toContain("Shadow route metadata stayed attached through commentary.ready");
    expect(html).not.toContain("411 deterministic fallback responses</td>");
  });

  it("styles the evidence panel and hides proof receipts from the plain presenter route", () => {
    expect(styles).toMatch(/\.admin-evidence\s*{/);
    expect(styles).toMatch(/\.admin-evidence-metrics\s*{/);
    expect(styles).toMatch(/body\.admin-view:not\(\.ai-learning-view\) #admin-load-evaluation/);
    expect(styles).toMatch(/body\.admin-view:not\(\.ai-learning-view\) #admin-ai-learning/);
  });

  it("keeps the AI learning route focused on commentary with compact route proof", () => {
    expect(html).toContain('id="admin-ai-learning"');
    expect(html).toContain("Live Commentary");
    expect(html).toContain('id="admin-commentary-feed"');
    expect(html).toContain('id="admin-ai-commentary-count"');
    expect(html).toContain('id="admin-ai-runtime"');
    expect(html).toContain('id="admin-ai-handoff"');
    expect(html).toContain('id="admin-ai-proof-gate"');
    expect(html).toContain('id="admin-ai-note-title"');
    expect(html).toContain('id="admin-ai-note-body"');
    expect(html).toContain("Gameplay facts stay in Oracle AI Database");
    const block = html.match(/<div id="admin-ai-learning"[\s\S]*?<\/div>\s*<\/section>/)?.[0] || "";
    expect(block).toContain("Every finished run appears below by player");
    expect(block).toContain("Live commentary uses the fastest grounded path");
    expect(block).not.toContain("oci-base");
    expect(block).not.toContain("oci-fine-tuned");
    expect(block).not.toContain("health + generation probe");
    expect(block).not.toContain("bounded generation check");
    expect(block).not.toContain("LLM proof gate");
    expect(block).not.toContain("202606132052-fastpath-full");
    expect(block).not.toContain("25 live examples");
    expect(block).not.toContain("Redacted behavior-only JSONL");
    expect(block).not.toContain("Trainer dry-run");
    expect(block).not.toContain("Strict upstream gate");
    expect(block).not.toContain("Checking generation proof");
    expect(script).toMatch(/function isAiLearningAdminPath\(path\)/);
    expect(script).toMatch(/path === "\/admin\/ai-learning" \|\| path === "\/admin\/ai"/);
    expect(script).toMatch(/updateAiLearningHealth/);
    expect(script).toMatch(/rememberAdminCommentary/);
    expect(script).toMatch(/renderAdminCommentaryFeed/);
    expect(worker).toMatch(/commentary\.history/);
    expect(adminAiHealth).toMatch(/generation_ready/);
    expect(adminAiHealth).toMatch(/generationDegraded/);
    expect(adminAiHealth).toContain("candidate degraded");
    expect(script).toContain("Select AI fast path is live; candidate needs attention.");
  });

  it("treats a proven base route plus timed-out candidate as degraded", () => {
    const summary = summarizeAiAdapterHealth({
      model_adapter_summary: {
        runtime_counts: {
          "oci-base:upstream-llm": 1,
          "oci-fine-tuned:missing": 1,
        },
        upstream_format_counts: {
          ollama: 1,
          missing: 1,
        },
        generation_ready_counts: {
          ready: 1,
          failed: 0,
          unknown: 1,
        },
        generation_ready: false,
        upstream_llm_ready: false,
      },
      model_adapters: [
        {
          ok: true,
          provider: "oci-base",
          configured: true,
          runtime_mode: "upstream-llm",
          upstream_format: "ollama",
          generation_ready: true,
        },
        {
          ok: false,
          provider: "oci-fine-tuned",
          configured: true,
          runtime_mode: null,
          upstream_format: null,
          error: "canvas_timeout_10000ms",
        },
      ],
    });

    expect(summary.ready).toBe(false);
    expect(summary.degraded).toBe(true);
    expect(summary.verdictText).toBe("Base ready");
    expect(summary.gateText).toBe("Stage-safe; trace off; candidate degraded");
    expect(summary.runtimeText).toBe("oci-base ready; oci-fine-tuned degraded");
  });

  it("labels the live Select AI path without claiming the candidate produced the line", () => {
    const summary = summarizeAiAdapterHealth({
      live_line_fast_return: true,
      indb_agent_enabled: true,
      canvas_configured: true,
      model_router: {
        route_mode: "primary",
        trace_persist: false,
      },
      model_adapter_summary: {
        generation_ready: false,
        upstream_llm_ready: false,
      },
      model_adapters: [
        {
          ok: true,
          provider: "oci-base",
          runtime_mode: "upstream-llm",
          upstream_format: "ollama",
          generation_ready: true,
        },
        {
          ok: true,
          provider: "oci-fine-tuned",
          runtime_mode: "upstream-llm",
          upstream_format: "ollama",
          generation_ready: false,
        },
      ],
    });

    expect(summary.ready).toBe(false);
    expect(summary.degraded).toBe(true);
    expect(summary.verdictText).toBe("Fast path live");
    expect(summary.runtimeText).toBe("Select AI fast path; oci-base ready; oci-fine-tuned degraded");
    expect(summary.handoffText).toBe("Canvas configured; in-db Select AI enabled; primary route");
    expect(summary.gateText).toBe("Stage-safe; trace off; candidate degraded");
  });

  it("styles the commentary-only AI learning screen", () => {
    expect(styles).toMatch(/\.admin-proof-receipts\s*{/);
    expect(styles).toMatch(/\.admin-learning-note\s*{/);
    expect(styles).toMatch(/body\.ai-learning-view #admin-load-evaluation/);
    expect(styles).toMatch(/\.admin-commentary-feed\s*{/);
    expect(styles).toMatch(/body\.ai-learning-view \.admin-commentary-panel/);
    expect(styles).toMatch(/body\.ai-learning-view \.admin-commentary-feed/);
    expect(styles).toMatch(/body\.ai-learning-view \.admin-grid/);
    expect(styles).toMatch(/body\.ai-learning-view \.admin-roster/);
  });

  it("adds a compact OCI observability route for live user analytics", () => {
    expect(html).toContain('id="admin-observability"');
    expect(html).toContain("Room Telemetry");
    expect(html).toContain('id="obs-connections"');
    expect(html).toContain('id="obs-humans"');
    expect(html).toContain('id="obs-commentary-job"');
    expect(html).toContain('id="obs-commentary-line"');
    expect(html).toContain('id="admin-observability-traces"');
    expect(html).toContain('id="admin-observability-rooms"');
    expect(script).toMatch(/const IS_OBSERVABILITY_VIEW =/);
    expect(script).toMatch(/updateObservabilityMetrics/);
    expect(script).toMatch(/observeWorkerEvent/);
    expect(script).toMatch(/Commentary job received/);
    expect(script).toMatch(/setObservabilityLatestCommentary/);
    expect(script).toMatch(/function commentaryGenerationLabel/);
    expect(script).toMatch(/payload\.select_ai_verified === true/);
    expect(script).toMatch(/proof\.select_ai_verified === true/);
    expect(script).toMatch(/DBMS_CLOUD_AI\.GENERATE:chat/);
    expect(script).toMatch(/\["Select AI", modelLabel, "direct", latencyLabel\]/);
    expect(script).toMatch(/latestGlobalObservabilityMetrics/);
    expect(script).toMatch(/latestRoomObservabilityMetrics/);
    expect(script).toMatch(/liveObservabilityPlayers/);
    expect(script).toMatch(/liveObservabilityRoomState/);
    expect(script).toMatch(/function strongestObservabilityPlayers/);
    expect(script).toMatch(/case "player\.state":/);
    expect(script).toMatch(/function stableObservabilityRooms\(\)/);
    expect(script).toMatch(/function deriveStableObservabilityRooms\(globalRooms = \{\}\)/);
    expect(script).toMatch(/function hasFreshCanonicalObservability\(\)/);
    expect(script).toMatch(/setTextById\("obs-connections", formatCount\(players\.total \?\? sockets\.connections\)\)/);
    expect(script).toMatch(/if \(!hasFreshCanonicalObservability\(\)\) \{\s*updateObservabilityMetrics\(body \|\| \{\}\);/);
    expect(script).toMatch(/if \(!hasFreshCanonicalObservability\(\)\) \{\s*roomsDirectory = body \|\| null;/);
    expect(script).not.toContain('items: { trash: 0, marine: 0, powerups: 0 }');
    expect(script).not.toMatch(/setTextById\("obs-humans", formatCount\(lobbyCount\)\)/);
    expect(script).toMatch(/parsePrometheusMetrics/);
    expect(script).toMatch(/fetch\("\/metrics"/);
    expect(styles).toMatch(/body\.admin-view:not\(\.observability-view\) #admin-observability/);
    expect(styles).toMatch(/\.admin-observability-trace-grid/);
    expect(styles).toMatch(/#admin-observability-traces li/);
    expect(styles).toMatch(/body\.observability-view \.admin-grid/);
    expect(styles).toMatch(/body\.observability-view \.admin-roster/);
    expect(styles).toMatch(/body\.observability-view \.admin-tabs/);
    expect(styles).toMatch(/body\.observability-view \.admin-room-strip/);
  });

  it("keeps observability explanation text under 30 words", () => {
    const block = html.match(/<div id="admin-observability"[\s\S]*?<div id="admin-load-evaluation"/)?.[0] || "";
    const prose = leafTextUnits(block);
    expect(prose.length).toBeGreaterThan(0);
    for (const text of prose) {
      expect(wordCount(text), text).toBeLessThanOrEqual(30);
    }
  });

  it("wires presenter admin grant without requiring player-socket ownership", () => {
    expect(html).toContain('id="admin-grant-target"');
    expect(html).toContain('id="btn-admin-grant"');
    expect(script).toMatch(/requestPresenterGrant/);
    expect(worker).toMatch(/admin\.presenter\.grant/);
  });

  it("shows PAF-trained bot persona metadata in the admin roster", () => {
    expect(script).toMatch(/botPolicy: value && value\.botPolicy/);
    expect(script).toMatch(/function mergeBotProfileEvidence\(id, profile = \{\}\)/);
    expect(script).toMatch(/function mergePlayerProfileEvidence\(id, profile = \{\}\)/);
    expect(script).toMatch(/otherPlayersInfo\[joinedId\] = mergePlayerProfileEvidence\(joinedId, body\.profile\);/);
    expect(script).toMatch(/\$\{policy\.name \|\| policy\.id\} · \$\{policy\.source \|\| p\.teacher \|\| "paf"\}/);
    expect(readFileSync("../bots/index.js", "utf8")).toMatch(/botPolicy: profile\.botPolicy/);
  });
});
