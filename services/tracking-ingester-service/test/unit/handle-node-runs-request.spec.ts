import { describe, expect, it } from "bun:test";
import type {
  NodeRunRow,
  NodeRunsQuery,
} from "../../src/lib/build-node-runs-query.js";
import { handleNodeRunsRequest } from "../../src/lib/handle-node-runs-request.js";

const ROW: NodeRunRow = {
  correlation_id: "corr-1",
  occurred_at: "2026-07-27T10:00:00.000Z",
  duration_ms: 395,
  step_status: "ok",
};

describe("handleNodeRunsRequest", () => {
  it("returns 400 when tenant is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleNodeRunsRequest(
      null,
      { correlationIds: "corr-1", actionName: "vipRoute" },
      {
        queryNodeRuns: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 for a blank tenant header", async () => {
    const result = await handleNodeRunsRequest(
      "  ",
      { correlationIds: "corr-1", actionName: "vipRoute" },
      { queryNodeRuns: async () => [] }
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when correlationIds is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleNodeRunsRequest(
      "tenant-a",
      { correlationIds: null, actionName: "vipRoute" },
      {
        queryNodeRuns: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("returns 400 when actionName is missing (stubbed pool never called)", async () => {
    let called = false;
    const result = await handleNodeRunsRequest(
      "tenant-a",
      { correlationIds: "corr-1", actionName: null },
      {
        queryNodeRuns: async () => {
          called = true;
          return [];
        },
      }
    );
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it("routes the built query to the injected pool, scoped by correlationIds + actionName, and shapes a 200 response", async () => {
    let seenQuery: NodeRunsQuery | null = null;
    const result = await handleNodeRunsRequest(
      "tenant-a",
      { correlationIds: "corr-1,corr-2", actionName: "vipRoute" },
      {
        queryNodeRuns: async (query) => {
          seenQuery = query;
          return [ROW];
        },
      }
    );

    expect(seenQuery).not.toBeNull();
    expect(seenQuery!.params).toEqual([
      ["corr-1", "corr-2"],
      "tenant-a",
      "vipRoute",
    ]);
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.tenant).toBe("tenant-a");
      expect(result.body.actionName).toBe("vipRoute");
      expect(result.body.correlationIdCount).toBe(2);
      expect(result.body.rowCount).toBe(1);
      expect(result.body.rows).toEqual([ROW]);
    }
  });

  it("returns 200 with an empty rows array when the node has no completed runs yet (legitimate empty case, never a 404)", async () => {
    const result = await handleNodeRunsRequest(
      "tenant-a",
      { correlationIds: "corr-1", actionName: "vipRoute" },
      { queryNodeRuns: async () => [] }
    );
    expect(result.status).toBe(200);
    if (result.status === 200) {
      expect(result.body.rows).toEqual([]);
      expect(result.body.rowCount).toBe(0);
    }
  });
});
