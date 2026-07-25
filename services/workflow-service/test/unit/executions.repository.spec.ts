import { describe, expect, it, mock } from "bun:test";
import { ExecutionsMongoRepository } from "../../src/modules/workflows/executions.mongo.repository";
import type { IWorkflowExecutionRow } from "../../src/modules/workflows/executions.repository.interface";
import {
  makeFakeTenantMongoConnections,
  makeMockDb,
  makeMongoCollectionMock,
} from "../make-mongo-mock";

const executionRow: IWorkflowExecutionRow = {
  id: "exe-1",
  definition_id: "def-1",
  temporal_workflow_id: "tw-1",
  temporal_run_id: "run-1",
  request: { k: 1 },
  status: "RUNNING",
  created_at: new Date("2024-06-01T00:00:00.000Z"),
  updated_at: new Date("2024-06-01T00:00:00.000Z"),
};

const executionDoc = {
  _id: "exe-1",
  definition_id: "def-1",
  temporal_workflow_id: "tw-1",
  temporal_run_id: "run-1",
  request: { k: 1 },
  status: "RUNNING",
  created_at: executionRow.created_at,
  updated_at: executionRow.updated_at,
};

function buildRepo(
  executionsCol: Record<string, unknown>
): ExecutionsMongoRepository {
  const db = makeMockDb({ workflow_executions: executionsCol });
  return new ExecutionsMongoRepository(makeFakeTenantMongoConnections(db));
}

describe("ExecutionsMongoRepository", () => {
  describe("createExecution", () => {
    it("inserts an execution and returns the row", async () => {
      const col = makeMongoCollectionMock({
        insertOne: async () => ({ acknowledged: true }),
      });
      const repo = buildRepo(col);

      const row = await repo.createExecution({
        id: "exe-1",
        definitionId: "def-1",
        tenantId: "t1",
        temporalWorkflowId: "tw-1",
        temporalRunId: "run-1",
        request: { orderId: "o1" },
      });
      expect(row.status).toBe("RUNNING");
      expect(row.temporal_workflow_id).toBe("tw-1");
    });
  });

  describe("updateExecutionStatus", () => {
    it("returns true when a row was updated", async () => {
      const col = makeMongoCollectionMock({
        updateOne: async () => ({ modifiedCount: 1 }),
      });
      const repo = buildRepo(col);

      const ok = await repo.updateExecutionStatus("exe-1", "t1", "COMPLETED");
      expect(ok).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const col = makeMongoCollectionMock({
        updateOne: async () => ({ modifiedCount: 0 }),
      });
      const repo = buildRepo(col);

      const ok = await repo.updateExecutionStatus("missing", "t1", "COMPLETED");
      expect(ok).toBe(false);
    });
  });

  describe("findExecutionById", () => {
    it("returns execution when present", async () => {
      const col = makeMongoCollectionMock({
        findOne: async () => executionDoc,
      });
      const repo = buildRepo(col);

      const row = await repo.findExecutionById("exe-1", "t1");
      expect(row?.id).toBe("exe-1");
    });
  });

  describe("findExecutionsByDefinition", () => {
    it("returns paginated executions for definition", async () => {
      const find = mock(() => ({
        sort: mock(() => ({
          skip: mock(() => ({
            limit: mock(() => ({
              toArray: mock(async () => [executionDoc]),
            })),
          })),
        })),
      }));
      const repo = buildRepo({ find });

      const rows = await repo.findExecutionsByDefinition({
        definitionId: "def-1",
        tenantId: "t1",
        limit: 20,
        offset: 0,
        sort: "desc",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.definition_id).toBe("def-1");
    });
  });

  describe("countExecutionsByDefinition", () => {
    it("returns the integer total", async () => {
      const col = makeMongoCollectionMock({
        countDocuments: async () => 7,
      });
      const repo = buildRepo(col);

      const total = await repo.countExecutionsByDefinition("def-1", "t1");
      expect(total).toBe(7);
    });
  });

  describe("countExecutionsGroupedByDefinition", () => {
    it("returns counts grouped by definition_id", async () => {
      const aggregate = mock(() => ({
        toArray: mock(async () => [
          { _id: "def-1", count: 3 },
          { _id: "def-2", count: 5 },
        ]),
      }));
      const col = { aggregate };
      const repo = buildRepo(col);

      const rows = await repo.countExecutionsGroupedByDefinition("t1");
      expect(rows).toEqual([
        { definition_id: "def-1", count: 3 },
        { definition_id: "def-2", count: 5 },
      ]);
    });
  });

  // T07 of manual-loops/admin-console/console-redesign-builder-v2.md — first
  // hop of the per-node stats join ("T06 findings" in that SPEC).
  describe("findCorrelationIdsByDefinition", () => {
    it("returns distinct correlation ids grouped from the aggregate pipeline", async () => {
      const aggregate = mock(() => ({
        toArray: mock(async () => [{ _id: "corr-1" }, { _id: "corr-2" }]),
      }));
      const col = { aggregate };
      const repo = buildRepo(col);

      const ids = await repo.findCorrelationIdsByDefinition(
        "def-1",
        "t1",
        new Date("2026-07-01T00:00:00.000Z"),
        500
      );
      expect(ids).toEqual(["corr-1", "corr-2"]);
      expect(aggregate).toHaveBeenCalledWith([
        {
          $match: {
            definition_id: "def-1",
            correlation_id: { $ne: null },
            created_at: { $gte: new Date("2026-07-01T00:00:00.000Z") },
          },
        },
        { $group: { _id: "$correlation_id" } },
        { $limit: 500 },
      ]);
    });

    it("returns an empty array for a definition with no runs in the window", async () => {
      const aggregate = mock(() => ({
        toArray: mock(async () => []),
      }));
      const col = { aggregate };
      const repo = buildRepo(col);

      const ids = await repo.findCorrelationIdsByDefinition(
        "def-1",
        "t1",
        new Date("2026-07-01T00:00:00.000Z"),
        500
      );
      expect(ids).toEqual([]);
    });
  });
});
