import { describe, expect, it } from "bun:test";
import { parseNodeStatsQuery } from "../../src/lib/parse-node-stats-query.js";

describe("parseNodeStatsQuery", () => {
  it("rejects a missing correlationIds param", () => {
    const result = parseNodeStatsQuery({ correlationIds: null });
    expect(result.ok).toBe(false);
  });

  it("rejects a blank correlationIds param", () => {
    const result = parseNodeStatsQuery({ correlationIds: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects a correlationIds param that reduces to nothing after trimming", () => {
    const result = parseNodeStatsQuery({ correlationIds: " , , " });
    expect(result.ok).toBe(false);
  });

  it("splits, trims, and dedupes a comma-separated list", () => {
    const result = parseNodeStatsQuery({
      correlationIds: "corr-1, corr-2 ,corr-1,corr-3",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.correlationIds).toEqual([
        "corr-1",
        "corr-2",
        "corr-3",
      ]);
    }
  });

  it("caps the list at MAX_LIST_LIMIT (500)", () => {
    const many = Array.from({ length: 600 }, (_, i) => `corr-${i}`).join(",");
    const result = parseNodeStatsQuery({ correlationIds: many });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.correlationIds.length).toBe(500);
    }
  });
});
