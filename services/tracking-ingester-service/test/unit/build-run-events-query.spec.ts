import { describe, expect, it } from "bun:test";
import { buildRunEventsQuery } from "../../src/lib/build-run-events-query.js";

describe("buildRunEventsQuery", () => {
  it("scopes by correlation_id and tenant (or null tenant)", () => {
    const { text } = buildRunEventsQuery("corr-1", "tenant-a");
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_events");
    expect(normalized).toContain("WHERE correlation_id = $1");
    expect(normalized).toContain("(tenant = $2 OR tenant IS NULL)");
    expect(normalized).toContain("ORDER BY occurred_at");
  });

  it("never selects *", () => {
    const { text } = buildRunEventsQuery("corr-1", "tenant-a");
    expect(text).not.toMatch(/SELECT\s+\*/i);
  });

  it("excludes the raw envelope jsonb column but extracts specific payload paths", () => {
    const { text } = buildRunEventsQuery("corr-1", "tenant-a");
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).not.toMatch(/,\s*envelope,/);
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'connectorId' AS payload_connector_id"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'agentId' AS payload_agent_id"
    );
    expect(columnsBlock).toContain(
      "envelope->'data'->'payload'->>'status' AS payload_step_status"
    );
  });

  it("includes workflow_id, run_id, connector_id, and has_envelope columns", () => {
    const { text } = buildRunEventsQuery("corr-1", "tenant-a");
    expect(text).toContain("workflow_id");
    expect(text).toContain("run_id");
    expect(text).toContain("connector_id");
    expect(text).toContain("(compliance <> 'none') AS has_envelope");
  });

  it("passes correlationId and tenant as positional params", () => {
    const { params } = buildRunEventsQuery("corr-1", "tenant-a");
    expect(params).toEqual(["corr-1", "tenant-a"]);
  });

  it("passes a null tenant through verbatim", () => {
    const { params } = buildRunEventsQuery("corr-1", null);
    expect(params).toEqual(["corr-1", null]);
  });
});
