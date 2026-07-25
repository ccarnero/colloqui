import { describe, expect, it } from "bun:test";
import type {
  NodeStatsQuery,
  NodeStatsRow,
} from "../../src/lib/build-node-stats-query.js";
import { handleNodeStatsRequest } from "../../src/lib/handle-node-stats-request.js";

const ROW: NodeStatsRow = {
  action_name: "Fetch user",
  branch: null,
  runs: 12,
  p95_ms: 620,
  ok_ratio: 0.98,
};

describe("handleNodeStatsRequest", () => {
  it("returns 400 when tenant is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleNodeStatsRequest(
      null,
      { correlationIds: "corr-1" },
      {
        queryNodeStats: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 for a blank tenant header", async () => {
    const result = await handleNodeStatsRequest(
      "  ",
      { correlationIds: "corr-1" },
      { queryNodeStats: async () => [] }
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when correlationIds is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleNodeStatsRequest(
      "tenant-a",
      { correlationIds: null },
      {
        queryNodeStats: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("routes the built query to the injected pool, scoped by correlationIds, and shapes a 200 response", async () => {
    let seenQuery: NodeStatsQuery | null = null;
    const result = await handleNodeStatsRequest(
      "tenant-a",
      { correlationIds: "corr-1,corr-2" },
      {
        queryNodeStats: async (query) => {
          seenQuery = query;
          return [ROW];
        },
      }
    );

    expect(seenQuery).not.toBeNull();
    expect(seenQuery!.params).toEqual([["corr-1", "corr-2"], "tenant-a"]);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.tenant).toBe("tenant-a");
      expect(result.body.correlationIdCount).toBe(2);
      expect(result.body.rowCount).toBe(1);
      expect(result.body.rows).toEqual([ROW]);
    }
  });

  it("returns 200 with an empty rows array when the definition has no completed runs yet (legitimate empty case, never a 404)", async () => {
    const result = await handleNodeStatsRequest(
      "tenant-a",
      { correlationIds: "corr-1" },
      { queryNodeStats: async () => [] }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.rows).toEqual([]);
      expect(result.body.rowCount).toBe(0);
    }
  });
});
