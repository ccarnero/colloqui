import { describe, expect, it } from "bun:test";
import { buildNodeStatsQuery } from "../../src/lib/build-node-stats-query.js";

describe("buildNodeStatsQuery", () => {
  it("scopes by correlation_id ANY(...) and tenant (or null tenant)", () => {
    const { text, params } = buildNodeStatsQuery(
      ["corr-1", "corr-2"],
      "tenant-a"
    );
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_events");
    expect(normalized).toContain("WHERE correlation_id = ANY($1::text[])");
    expect(normalized).toContain("(tenant = $2 OR tenant IS NULL)");
    expect(params).toEqual([["corr-1", "corr-2"], "tenant-a"]);
  });

  it("filters to action_started/action_completed kinds", () => {
    const { text } = buildNodeStatsQuery(["corr-1"], "tenant-a");
    expect(text).toContain("kind IN ('action_started', 'action_completed')");
  });

  it("self-joins on (correlation_id, action_index, branch), NOT entity_id/kind_prefix — the pairing view's shape (T06 findings caveat)", () => {
    const { text } = buildNodeStatsQuery(["corr-1"], "tenant-a");
    expect(text).toContain("c.correlation_id = s.correlation_id");
    expect(text).toContain("c.action_index   = s.action_index");
    expect(text).toContain("COALESCE(c.branch, '') = COALESCE(s.branch, '')");
    expect(text).not.toContain("entity_id");
    expect(text).not.toContain("kind_prefix");
  });

  it("groups by action_name and branch, aggregating runs/p95_ms/ok_ratio", () => {
    const { text } = buildNodeStatsQuery(["corr-1"], "tenant-a");
    expect(text).toContain("GROUP BY action_name, branch");
    expect(text).toContain("COUNT(*)::int");
    expect(text).toContain("percentile_cont(0.95)");
    expect(text).toContain("ok_ratio");
  });

  it("never selects * and never reads tracking.tracked_event_spans", () => {
    const { text } = buildNodeStatsQuery(["corr-1"], "tenant-a");
    expect(text).not.toMatch(/SELECT\s+\*/i);
    expect(text).not.toContain("tracked_event_spans");
  });

  it("excludes started rows with a null action_name (non-action events never reach the aggregate)", () => {
    const { text } = buildNodeStatsQuery(["corr-1"], "tenant-a");
    expect(text).toContain("s.action_name IS NOT NULL");
  });
});
