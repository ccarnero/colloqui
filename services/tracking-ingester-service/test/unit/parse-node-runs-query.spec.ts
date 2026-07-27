import { describe, expect, it } from "bun:test";
import { parseNodeRunsQuery } from "../../src/lib/parse-node-runs-query.js";

describe("parseNodeRunsQuery", () => {
  it("rejects a missing correlationIds param", () => {
    const result = parseNodeRunsQuery({
      correlationIds: null,
      actionName: "vipRoute",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a blank correlationIds param", () => {
    const result = parseNodeRunsQuery({
      correlationIds: "   ",
      actionName: "vipRoute",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a correlationIds param that reduces to nothing after trimming", () => {
    const result = parseNodeRunsQuery({
      correlationIds: " , , ",
      actionName: "vipRoute",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing actionName param (stubbed pool never called)", () => {
    const result = parseNodeRunsQuery({
      correlationIds: "corr-1",
      actionName: null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a blank actionName param", () => {
    const result = parseNodeRunsQuery({
      correlationIds: "corr-1",
      actionName: "   ",
    });
    expect(result.ok).toBe(false);
  });

  it("splits, trims, and dedupes a comma-separated correlationIds list, and trims actionName", () => {
    const result = parseNodeRunsQuery({
      correlationIds: "corr-1, corr-2 ,corr-1,corr-3",
      actionName: " vipRoute ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.correlationIds).toEqual([
        "corr-1",
        "corr-2",
        "corr-3",
      ]);
      expect(result.value.actionName).toBe("vipRoute");
    }
  });

  it("caps the correlationIds list at MAX_LIST_LIMIT (500)", () => {
    const many = Array.from({ length: 600 }, (_, i) => `corr-${i}`).join(",");
    const result = parseNodeRunsQuery({
      correlationIds: many,
      actionName: "vipRoute",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.correlationIds.length).toBe(500);
    }
  });
});
