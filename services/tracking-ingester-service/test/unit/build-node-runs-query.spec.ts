import { describe, expect, it } from "bun:test";
import { buildNodeRunsQuery } from "../../src/lib/build-node-runs-query.js";

describe("buildNodeRunsQuery", () => {
  it("scopes by correlation_id ANY(...), tenant (or null tenant), and actionName", () => {
    const { text, params } = buildNodeRunsQuery(
      ["corr-1", "corr-2"],
      "tenant-a",
      "vipRoute"
    );
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_events");
    expect(normalized).toContain("WHERE correlation_id = ANY($1::text[])");
    expect(normalized).toContain("(tenant = $2 OR tenant IS NULL)");
    expect(normalized).toContain("s.action_name = $3");
    expect(params).toEqual([["corr-1", "corr-2"], "tenant-a", "vipRoute"]);
  });

  it("filters to action_started/action_completed kinds", () => {
    const { text } = buildNodeRunsQuery(["corr-1"], "tenant-a", "vipRoute");
    expect(text).toContain("kind IN ('action_started', 'action_completed')");
  });

  it("self-joins on (correlation_id, action_index, branch), NOT entity_id/kind_prefix", () => {
    const { text } = buildNodeRunsQuery(["corr-1"], "tenant-a", "vipRoute");
    expect(text).toContain("c.correlation_id = s.correlation_id");
    expect(text).toContain("c.action_index   = s.action_index");
    expect(text).toContain("COALESCE(c.branch, '') = COALESCE(s.branch, '')");
    expect(text).not.toContain("entity_id");
    expect(text).not.toContain("kind_prefix");
  });

  it("has NO GROUP BY (ungrouped sibling of build-node-stats-query.ts)", () => {
    const { text } = buildNodeRunsQuery(["corr-1"], "tenant-a", "vipRoute");
    expect(text).not.toContain("GROUP BY");
  });

  it("orders most-recent-first and caps at 20 rows", () => {
    const { text } = buildNodeRunsQuery(["corr-1"], "tenant-a", "vipRoute");
    expect(text).toContain("ORDER BY c.occurred_at DESC");
    expect(text).toContain("LIMIT 20");
  });

  it("never selects * and never reads tracking.tracked_event_spans", () => {
    const { text } = buildNodeRunsQuery(["corr-1"], "tenant-a", "vipRoute");
    expect(text).not.toMatch(/SELECT\s+\*/i);
    expect(text).not.toContain("tracked_event_spans");
  });
});
