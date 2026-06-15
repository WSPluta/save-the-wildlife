import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("src/index.html", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const script = readFileSync("src/script.js", "utf8");

describe("admin load evaluation view", () => {
  it("adds canary evidence to the presenter admin UI", () => {
    expect(html).toContain('id="admin-load-evaluation"');
    expect(html).toContain("Load Gate Proof");
    expect(html).toContain("Tier 1000 pass");
    expect(script).toMatch(/path === "\/admin" \|\| path === "\/admin\/ai-learning"/);
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
    expect(html).toContain("Learning Gate");
    expect(html).toContain("Facts in memory, behavior in weights");
    expect(html).toContain("oci-base");
    expect(html).toContain("oci-fine-tuned");
    expect(html).toContain("behavior-adapter");
    expect(html).toContain("upstream formats openai:2");
    expect(html).toContain("OpenAI upstream handoff contract");
    expect(html).toContain("LLM proof gate");
    expect(html).toContain("202606132052-fastpath-full");
    expect(html).toContain("25 live examples");
    expect(html).toContain("Redacted behavior-only JSONL");
    expect(html).toContain("Trainer dry-run");
    expect(html).toContain("202606140238-upstream-gate-refresh");
    expect(html).toContain("blocked only on behavior-adapter runtime");
    expect(html).toContain("Promotion held for upstream GPU LLM runtime");
    expect(html).toContain("runtime_mode=upstream-llm");
  });

  it("styles the compact AI learning receipt panels", () => {
    expect(styles).toMatch(/\.admin-proof-receipts\s*{/);
    expect(styles).toMatch(/\.admin-learning-note\s*{/);
  });
});
