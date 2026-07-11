import { describe, expect, it } from "bun:test";
import { buildSpansQuery } from "../../src/lib/build-spans-query.js";

describe("buildSpansQuery", () => {
  it("scopes by correlation_id and tenant (or null tenant)", () => {
    const { text } = buildSpansQuery("corr-1", "tenant-a");
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_event_spans");
    expect(normalized).toContain("WHERE correlation_id = $1");
    expect(normalized).toContain("(tenant = $2 OR tenant IS NULL)");
    expect(normalized).toContain("ORDER BY started_at");
  });

  it("never selects *", () => {
    const { text } = buildSpansQuery("corr-1", "tenant-a");
    expect(text).not.toMatch(/SELECT\s+\*/i);
  });

  it("aliases start_time/end_time to started_at/completed_at and selects duration_ms", () => {
    const { text } = buildSpansQuery("corr-1", "tenant-a");
    expect(text).toContain("start_time AS started_at");
    expect(text).toContain("end_time AS completed_at");
    expect(text).toContain("duration_ms");
  });

  it("selects kind_prefix and entity_id (SPEC.md T01 required columns)", () => {
    const { text } = buildSpansQuery("corr-1", "tenant-a");
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toMatch(/SELECT\s+kind_prefix,\s*entity_id,/);
  });

  it("selects exactly the five SPEC.md T01 columns, no more", () => {
    const { text } = buildSpansQuery("corr-1", "tenant-a");
    const selectClause = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    const columns = selectClause
      .split(",")
      .map((column) => column.replace(/\s+/g, " ").trim());
    expect(columns).toEqual([
      "kind_prefix",
      "entity_id",
      "start_time AS started_at",
      "end_time AS completed_at",
      "duration_ms",
    ]);
  });

  it("passes correlationId and tenant as positional params", () => {
    const { params } = buildSpansQuery("corr-1", "tenant-a");
    expect(params).toEqual(["corr-1", "tenant-a"]);
  });

  it("passes a null tenant through verbatim", () => {
    const { params } = buildSpansQuery("corr-1", null);
    expect(params).toEqual(["corr-1", null]);
  });
});
