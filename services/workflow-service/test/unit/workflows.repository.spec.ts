import { describe, it, expect, mock } from "bun:test";
import { WorkflowsMongoRepository } from "../../src/modules/workflows/workflows.mongo.repository";
import type { IWorkflowDefinitionRow } from "../../src/modules/workflows/workflows.repository.interface";
import {
  makeFakeTenantMongoConnections,
  makeMockDb,
  makeMongoCollectionMock,
} from "../make-mongo-mock";

const definitionRow: IWorkflowDefinitionRow = {
  id: "def-1",
  name: "Flow",
  application: "app",
  actions: [{ activity: "jsFunction", name: "n1", args: { code: "return 1" } }],
  trigger: null,
  created_at: new Date("2024-06-01T00:00:00.000Z"),
  updated_at: new Date("2024-06-01T00:00:00.000Z"),
  deleted_at: null,
};

const definitionDoc = {
  _id: "def-1",
  name: "Flow",
  application: "app",
  actions: definitionRow.actions,
  trigger: null,
  created_at: definitionRow.created_at,
  updated_at: definitionRow.updated_at,
  deleted_at: null,
};

function buildRepo(definitionsCol: Record<string, unknown>): WorkflowsMongoRepository {
  const db = makeMockDb({ workflow_definitions: definitionsCol });
  return new WorkflowsMongoRepository(makeFakeTenantMongoConnections(db));
}

describe("WorkflowsMongoRepository", () => {
  describe("createDefinition", () => {
    it("inserts a workflow definition and returns the row", async () => {
      const col = makeMongoCollectionMock({
        insertOne: async () => ({ acknowledged: true }),
      });
      const repo = buildRepo(col);

      const row = await repo.createDefinition({
        id: "def-1",
        tenantId: "t1",
        name: "Flow",
        application: "app",
        actions: definitionRow.actions as unknown[],
      });
      expect(row.id).toBe("def-1");
      expect(row.actions).toEqual(definitionRow.actions);
    });

    it("propagates Mongo errors", async () => {
      const col = makeMongoCollectionMock({
        insertOne: async () => {
          throw new Error("db unavailable");
        },
      });
      const repo = buildRepo(col);

      await expect(
        repo.createDefinition({
          id: "def-1",
          tenantId: "t1",
          name: "Flow",
          application: "app",
          actions: [],
        }),
      ).rejects.toThrow("db unavailable");
    });
  });

  describe("findDefinitionById", () => {
    it("returns a row when present", async () => {
      const col = makeMongoCollectionMock({
        findOne: async () => definitionDoc,
      });
      const repo = buildRepo(col);

      const row = await repo.findDefinitionById("def-1", "t1");
      expect(row?.id).toBe("def-1");
    });

    it("returns undefined when no row", async () => {
      const col = makeMongoCollectionMock({
        findOne: async () => null,
      });
      const repo = buildRepo(col);

      const row = await repo.findDefinitionById("missing", "t1");
      expect(row).toBeUndefined();
    });
  });

  describe("findDefinitionsByTenant", () => {
    it("returns ordered list for tenant", async () => {
      const find = mock(() => ({
        sort: mock(() => ({
          toArray: mock(async () => [definitionDoc]),
        })),
      }));
      const col = { find };
      const repo = buildRepo(col);

      const rows = await repo.findDefinitionsByTenant("t1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("def-1");
    });
  });

  describe("softDeleteDefinition", () => {
    it("returns true when a row was updated", async () => {
      const col = makeMongoCollectionMock({
        updateOne: async () => ({ modifiedCount: 1 }),
      });
      const repo = buildRepo(col);

      const ok = await repo.softDeleteDefinition("def-1", "t1");
      expect(ok).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const col = makeMongoCollectionMock({
        updateOne: async () => ({ modifiedCount: 0 }),
      });
      const repo = buildRepo(col);

      const ok = await repo.softDeleteDefinition("missing", "t1");
      expect(ok).toBe(false);
    });
  });
});
