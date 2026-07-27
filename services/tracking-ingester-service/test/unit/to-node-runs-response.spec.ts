import { describe, expect, it } from "bun:test";
import type { NodeRunRow } from "../../src/lib/build-node-runs-query.js";
import { toNodeRunsResponse } from "../../src/lib/to-node-runs-response.js";

const ROW: NodeRunRow = {
  correlation_id: "corr-1",
  occurred_at: "2026-07-27T10:00:00.000Z",
  duration_ms: 395,
  step_status: "ok",
};

describe("toNodeRunsResponse", () => {
  it("shapes tenant, actionName, correlationIdCount, rowCount and rows", () => {
    const response = toNodeRunsResponse("acme", "vipRoute", 23, [ROW]);
    expect(response).toEqual({
      tenant: "acme",
      actionName: "vipRoute",
      correlationIdCount: 23,
      rowCount: 1,
      rows: [ROW],
    });
  });

  it("shapes an empty rows array with rowCount 0", () => {
    const response = toNodeRunsResponse("acme", "vipRoute", 23, []);
    expect(response.rowCount).toBe(0);
    expect(response.rows).toEqual([]);
  });
});
