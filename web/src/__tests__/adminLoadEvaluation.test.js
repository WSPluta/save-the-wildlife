import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("src/index.html", "utf8");
const styles = readFileSync("src/style.css", "utf8");
const script = readFileSync("src/script.js", "utf8");

describe("admin load evaluation view", () => {
  it("adds canary evidence to the presenter admin UI", () => {
    expect(html).toContain('id="admin-load-evaluation"');
    expect(html).toContain("Player Join and Commentary Evaluation");
    expect(html).toContain("Passed to 1000");
    expect(script).toMatch(/path === "\/admin" \|\| path === "\/admin\/ai-learning"/);
  });

  it("shows the tracked gates for score rows, commentary source, duplicates, and fallback", () => {
    expect(html).toContain("High-score test rows matched joined players");
    expect(html).toContain("Commentary source stayed Oracle private-agent-factory");
    expect(html).toContain("Duplicate commentary count stayed 0");
    expect(html).toContain("No deterministic fallback commentary accepted");
  });

  it("preserves the tier 500 failure and passing reruns for demo storytelling", () => {
    expect(html).toContain("202606122103");
    expect(html).toContain("4 commentary timeouts at 10s");
    expect(html).toContain("202606122139");
    expect(html).toContain("PAF floor raised to 4");
    expect(html).toContain("202606122141");
    expect(html).toContain("1000/1000");
  });

  it("styles the evidence panel, timeline, gates, and run table", () => {
    expect(styles).toMatch(/\.admin-evidence\s*{/);
    expect(styles).toMatch(/\.admin-evidence-metrics\s*{/);
    expect(styles).toMatch(/\.admin-timeline\s*,/);
    expect(styles).toMatch(/\.admin-gate-list\s*{/);
    expect(styles).toMatch(/\.admin-run-table\s*{/);
  });

  it("adds the AI learning route evidence for base versus fine-tuned PAF", () => {
    expect(html).toContain('id="admin-ai-learning"');
    expect(html).toContain("Continuous Learning Evidence");
    expect(html).toContain("Facts in memory, behavior in weights");
    expect(html).toContain("STWL_MODEL_TRACES");
    expect(html).toContain("oci-base");
    expect(html).toContain("oci-fine-tuned");
    expect(html).toContain("uses_retrieved_evidence");
    expect(html).toContain("High-score test table verified 1000/1000 rows");
  });

  it("styles the AI learning pipeline, comparison, and rubric panels", () => {
    expect(styles).toMatch(/\.admin-learning-pipeline\s*{/);
    expect(styles).toMatch(/\.admin-comparison\s*{/);
    expect(styles).toMatch(/\.admin-rubric-grid\s*{/);
    expect(styles).toMatch(/\.admin-learning-note\s*{/);
  });
});
