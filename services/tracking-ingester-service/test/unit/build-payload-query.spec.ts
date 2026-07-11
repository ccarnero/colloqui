import { describe, expect, it } from "bun:test";
import { buildPayloadQuery } from "../../src/lib/build-payload-query.js";

describe("buildPayloadQuery", () => {
  it("scopes by correlation_id, event_id, and tenant (tenant OR NULL rule)", () => {
    const query = buildPayloadQuery("corr-1", "evt-1", "tenant-a");
    expect(query.params).toEqual(["corr-1", "evt-1", "tenant-a"]);
    expect(query.text).toContain("correlation_id = $1");
    expect(query.text).toContain("event_id = $2");
    expect(query.text).toContain("(tenant = $3 OR tenant IS NULL)");
  });

  it("selects payload_status and the jsonb payload path", () => {
    const query = buildPayloadQuery("corr-1", "evt-1", "tenant-a");
    expect(query.text).toContain("payload_status");
    expect(query.text).toContain("envelope->'data'->'payload'");
  });

  it("never selects the raw envelope column directly", () => {
    const query = buildPayloadQuery("corr-1", "evt-1", "tenant-a");
    expect(query.text).not.toMatch(/SELECT\s+\*/i);
  });

  it("accepts a null tenant (drift-row lookup)", () => {
    const query = buildPayloadQuery("corr-1", "evt-1", null);
    expect(query.params).toEqual(["corr-1", "evt-1", null]);
  });
});
