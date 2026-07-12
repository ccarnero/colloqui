import { describe, expect, it } from "bun:test";
import { buildRunRootQuery } from "../../src/lib/build-run-root-query.js";

describe("buildRunRootQuery", () => {
  it("scopes by workflow_id, run_id, kind, and tenant", () => {
    const { text } = buildRunRootQuery("wf-1", "run-1", "tenant-a");
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_events");
    expect(normalized).toContain("WHERE workflow_id = $1");
    expect(normalized).toContain("AND run_id = $2");
    expect(normalized).toContain("AND kind = 'execution_started'");
    expect(normalized).toContain("AND tenant = $3");
  });

  it("does not allow a NULL-tenant match (canonical rows only)", () => {
    const { text } = buildRunRootQuery("wf-1", "run-1", "tenant-a");
    expect(text).not.toMatch(/tenant IS NULL/);
  });

  it("selects only correlation_id", () => {
    const { text } = buildRunRootQuery("wf-1", "run-1", "tenant-a");
    expect(text).not.toMatch(/SELECT\s+\*/i);
    expect(text).toContain("SELECT correlation_id");
  });

  it("limits to one row", () => {
    const { text } = buildRunRootQuery("wf-1", "run-1", "tenant-a");
    expect(text).toContain("LIMIT 1");
  });

  it("passes workflowId, runId, and tenant as positional params", () => {
    const { params } = buildRunRootQuery("wf-1", "run-1", "tenant-a");
    expect(params).toEqual(["wf-1", "run-1", "tenant-a"]);
  });
});
