import { describe, expect, it, mock } from "bun:test";
import { WorkflowsMongoRepository } from "../../src/modules/workflows/workflows.mongo.repository";
import { WorkflowsPostgresRepository } from "../../src/modules/workflows/workflows.postgres.repository";
import {
  type IWorkflowDefinitionRow,
  WorkflowNotFoundError,
} from "../../src/modules/workflows/workflows.repository.interface";
import {
  makeFakeTenantMongoConnections,
  makeMockDb,
  makeMongoCollectionMock,
} from "../make-mongo-mock";

/**
 * Minimal fake of postgres.js's tagged-template `Sql` callable, capturing
 * the joined query text (`?` in place of each interpolation) and the raw
 * values passed in, so assertions can check both the SQL shape and the
 * bound parameters without a real Postgres connection.
 */
function makeFakeSql(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    json: (value: unknown) => unknown;
  };
  fn.json = (value: unknown) => value;
  return { fn, calls };
}

function buildPostgresRepo(rows: unknown[] = []): {
  repo: WorkflowsPostgresRepository;
  calls: { text: string; values: unknown[] }[];
} {
  const { fn, calls } = makeFakeSql(rows);
  const repo = new WorkflowsPostgresRepository({
    ensureSchema: mock(async () => fn),
  } as any);
  return { repo, calls };
}

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

function buildRepo(
  definitionsCol: Record<string, unknown>
): WorkflowsMongoRepository {
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
      expect(row.status).toBe("enabled");
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
        })
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

    it("defaults status to 'enabled' for legacy docs missing the field", async () => {
      // definitionDoc predates the `status` column/field entirely.
      const col = makeMongoCollectionMock({
        findOne: async () => definitionDoc,
      });
      const repo = buildRepo(col);

      const row = await repo.findDefinitionById("def-1", "t1");
      expect(row?.status).toBe("enabled");
    });

    it("preserves a persisted 'disabled' status", async () => {
      const col = makeMongoCollectionMock({
        findOne: async () => ({ ...definitionDoc, status: "disabled" }),
      });
      const repo = buildRepo(col);

      const row = await repo.findDefinitionById("def-1", "t1");
      expect(row?.status).toBe("disabled");
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

  describe("setStatus", () => {
    it("sets status to 'disabled' and returns the updated row", async () => {
      const findOneAndUpdate = mock(async () => ({
        ...definitionDoc,
        status: "disabled",
      }));
      const col = makeMongoCollectionMock({ findOneAndUpdate });
      const repo = buildRepo(col);

      const row = await repo.setStatus("t1", "def-1", "disabled");
      expect(row.status).toBe("disabled");
      const filter = findOneAndUpdate.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(filter._id).toBe("def-1");
      expect(filter.deleted_at).toBeNull();
    });

    it("sets status to 'enabled' and returns the updated row", async () => {
      const col = makeMongoCollectionMock({
        findOneAndUpdate: async () => ({
          ...definitionDoc,
          status: "enabled",
        }),
      });
      const repo = buildRepo(col);

      const row = await repo.setStatus("t1", "def-1", "enabled");
      expect(row.status).toBe("enabled");
    });

    it("is idempotent when re-setting the same status", async () => {
      const col = makeMongoCollectionMock({
        findOneAndUpdate: async () => ({
          ...definitionDoc,
          status: "disabled",
        }),
      });
      const repo = buildRepo(col);

      const first = await repo.setStatus("t1", "def-1", "disabled");
      const second = await repo.setStatus("t1", "def-1", "disabled");
      expect(first.status).toBe("disabled");
      expect(second.status).toBe("disabled");
    });

    it("throws WorkflowNotFoundError for an unknown id", async () => {
      const col = makeMongoCollectionMock({
        findOneAndUpdate: async () => null,
      });
      const repo = buildRepo(col);

      await expect(repo.setStatus("t1", "missing", "disabled")).rejects.toThrow(
        WorkflowNotFoundError
      );
    });
  });
});

describe("WorkflowsPostgresRepository", () => {
  describe("setStatus", () => {
    it("sets status to 'disabled' and returns the updated row", async () => {
      const { repo, calls } = buildPostgresRepo([
        { ...definitionRow, status: "disabled" },
      ]);

      const row = await repo.setStatus("t1", "def-1", "disabled");
      expect(row.status).toBe("disabled");
      expect(calls[0]!.text).toContain("UPDATE workflow_definitions");
      expect(calls[0]!.text).toContain("SET status");
      expect(calls[0]!.text).toContain("deleted_at IS NULL");
      expect(calls[0]!.values).toContain("disabled");
      expect(calls[0]!.values).toContain("def-1");
    });

    it("sets status to 'enabled' and returns the updated row", async () => {
      const { repo } = buildPostgresRepo([
        { ...definitionRow, status: "enabled" },
      ]);

      const row = await repo.setStatus("t1", "def-1", "enabled");
      expect(row.status).toBe("enabled");
    });

    it("is idempotent when re-setting the same status", async () => {
      const { repo } = buildPostgresRepo([
        { ...definitionRow, status: "disabled" },
      ]);

      const first = await repo.setStatus("t1", "def-1", "disabled");
      const second = await repo.setStatus("t1", "def-1", "disabled");
      expect(first.status).toBe("disabled");
      expect(second.status).toBe("disabled");
    });

    it("throws WorkflowNotFoundError for an unknown id", async () => {
      const { repo } = buildPostgresRepo([]);

      await expect(repo.setStatus("t1", "missing", "disabled")).rejects.toThrow(
        WorkflowNotFoundError
      );
    });
  });
});
