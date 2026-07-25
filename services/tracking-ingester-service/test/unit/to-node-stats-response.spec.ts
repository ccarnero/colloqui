import { describe, expect, it } from "bun:test";
import type { NodeStatsRow } from "../../src/lib/build-node-stats-query.js";
import { toNodeStatsResponse } from "../../src/lib/to-node-stats-response.js";

describe("toNodeStatsResponse", () => {
  it("shapes tenant, correlationIdCount, rowCount, and rows", () => {
    const rows: NodeStatsRow[] = [
      {
        action_name: "Fetch user",
        branch: null,
        runs: 12,
        p95_ms: 620,
        ok_ratio: 0.98,
      },
    ];
    const response = toNodeStatsResponse("tenant-a", 5, rows);
    expect(response).toEqual({
      tenant: "tenant-a",
      correlationIdCount: 5,
      rowCount: 1,
      rows,
    });
  });

  it("shapes an empty rows array with rowCount 0", () => {
    const response = toNodeStatsResponse("tenant-a", 3, []);
    expect(response.rowCount).toBe(0);
    expect(response.rows).toEqual([]);
  });
});
