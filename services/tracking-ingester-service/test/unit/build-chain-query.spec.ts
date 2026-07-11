import { describe, expect, it } from "bun:test";
import { buildChainQuery } from "../../src/lib/build-chain-query.js";

describe("buildChainQuery", () => {
  it("scopes by correlation_id and tenant (or null tenant)", () => {
    const { text } = buildChainQuery("corr-1", "tenant-a");
    const normalized = text.replace(/\s+/g, " ").trim();
    expect(normalized).toContain("FROM tracking.tracked_events");
    expect(normalized).toContain("WHERE correlation_id = $1");
    expect(normalized).toContain("(tenant = $2 OR tenant IS NULL)");
    expect(normalized).toContain("ORDER BY occurred_at");
  });

  it("never selects *", () => {
    const { text } = buildChainQuery("corr-1", "tenant-a");
    expect(text).not.toMatch(/SELECT\s+\*/i);
  });

  it("excludes the raw envelope jsonb column", () => {
    const { text } = buildChainQuery("corr-1", "tenant-a");
    const columnsBlock = text.slice(
      text.indexOf("SELECT") + "SELECT".length,
      text.indexOf("FROM")
    );
    expect(columnsBlock).not.toMatch(/\benvelope\b/);
  });

  it("includes a derived has_envelope boolean column", () => {
    const { text } = buildChainQuery("corr-1", "tenant-a");
    expect(text).toContain("(compliance <> 'none') AS has_envelope");
  });

  it("passes correlationId and tenant as positional params", () => {
    const { params } = buildChainQuery("corr-1", "tenant-a");
    expect(params).toEqual(["corr-1", "tenant-a"]);
  });

  it("passes a null tenant through verbatim", () => {
    const { params } = buildChainQuery("corr-1", null);
    expect(params).toEqual(["corr-1", null]);
  });
});
