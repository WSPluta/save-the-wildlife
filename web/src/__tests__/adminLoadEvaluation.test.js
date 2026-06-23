import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("src/index.html", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const script = readFileSync("src/script.js", "utf8");
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

  it("adds the AI learning route evidence for base versus fine-tuned PAF", () => {
    expect(html).toContain('id="admin-ai-learning"');
    expect(html).toContain("Live Commentary");
    expect(html).toContain('id="admin-commentary-feed"');
    expect(html).toContain('id="admin-ai-commentary-count"');
    expect(html).toContain("Gameplay facts stay in Oracle AI Database");
    expect(html).toContain("oci-base");
    expect(html).toContain("oci-fine-tuned");
    expect(html).toContain("health + generation probe");
    expect(html).toContain("bounded generation check");
    expect(html).toContain("LLM proof gate");
    expect(html).toContain("202606132052-fastpath-full");
    expect(html).toContain("25 live examples");
    expect(html).toContain("Redacted behavior-only JSONL");
    expect(html).toContain("Trainer dry-run");
    expect(html).toContain("Strict upstream gate");
    expect(html).toContain("Checking generation proof");
    expect(html).toContain("facts stay in database");
    expect(script).toMatch(/function isAiLearningAdminPath\(path\)/);
    expect(script).toMatch(/path === "\/admin\/ai-learning" \|\| path === "\/admin\/ai"/);
    expect(script).toMatch(/updateAiLearningHealth/);
    expect(script).toMatch(/rememberAdminCommentary/);
    expect(script).toMatch(/renderAdminCommentaryFeed/);
    expect(worker).toMatch(/commentary\.history/);
    expect(script).toMatch(/generation_ready/);
    expect(script).toMatch(/generationDegraded/);
    expect(script).toContain("Base ready; candidate degraded");
    expect(script).toContain("Base route is live; candidate needs attention.");
  });

  it("styles the compact AI learning receipt panels", () => {
    expect(styles).toMatch(/\.admin-proof-receipts\s*{/);
    expect(styles).toMatch(/\.admin-learning-note\s*{/);
    expect(styles).toMatch(/body\.ai-learning-view #admin-load-evaluation/);
    expect(styles).toMatch(/\.admin-commentary-feed\s*{/);
    expect(styles).toMatch(/\.admin-ai-route-metrics \.admin-metric strong/);
    expect(styles).toMatch(/body\.ai-learning-view \.admin-grid/);
    expect(styles).toMatch(/body\.ai-learning-view \.admin-roster/);
  });

  it("adds a compact OCI observability route for live user analytics", () => {
    expect(html).toContain('id="admin-observability"');
    expect(html).toContain("Live Operations");
    expect(html).toContain('id="obs-connections"');
    expect(html).toContain('id="obs-humans"');
    expect(html).toContain('id="admin-observability-rooms"');
    expect(html).toContain("stwl_socket_connections");
    expect(script).toMatch(/const IS_OBSERVABILITY_VIEW =/);
    expect(script).toMatch(/updateObservabilityMetrics/);
    expect(script).toMatch(/latestGlobalObservabilityMetrics/);
    expect(script).toMatch(/latestRoomObservabilityMetrics/);
    expect(script).toMatch(/function stableObservabilityRooms\(\)/);
    expect(script).toMatch(/function deriveStableObservabilityRooms\(globalRooms = \{\}\)/);
    expect(script).not.toContain('items: { trash: 0, marine: 0, powerups: 0 }');
    expect(script).not.toMatch(/setTextById\("obs-humans", formatCount\(lobbyCount\)\)/);
    expect(script).toMatch(/parsePrometheusMetrics/);
    expect(script).toMatch(/fetch\("\/metrics"/);
    expect(styles).toMatch(/body\.admin-view:not\(\.observability-view\) #admin-observability/);
    expect(styles).toMatch(/body\.observability-view \.admin-grid/);
    expect(styles).toMatch(/body\.observability-view \.admin-roster/);
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
    expect(script).toMatch(/otherPlayersInfo\[joinedId\] = mergeBotProfileEvidence\(joinedId, body\.profile\);/);
    expect(script).toMatch(/\$\{policy\.name \|\| policy\.id\} · \$\{policy\.source \|\| p\.teacher \|\| "paf"\}/);
    expect(readFileSync("../bots/index.js", "utf8")).toMatch(/botPolicy: profile\.botPolicy/);
  });
});
