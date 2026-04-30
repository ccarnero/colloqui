import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Sql } from "postgres";
import { WorkflowsRepository } from "../../src/modules/workflows/workflows.repository";
import { WorkflowTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import type {
  IWorkflowDefinitionRow,
  IWorkflowExecutionRow,
} from "../../src/modules/workflows/workflows.repository";

function makeSql(
  impl: (strings: TemplateStringsArray, values: unknown[]) => Promise<unknown>,
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) =>
    impl(strings, values);
  return Object.assign(fn, {
    json: (x: never) => x,
    unsafe: mock((_q: string, _p: unknown[]) => Promise.resolve(undefined)),
  }) as Sql;
}

/**
 * Minimal stand-in for {@link WorkflowTenantConnectionManager} — exposes
 * an `ensureSchema` that always resolves to the provided Sql so the
 * repository's per-tenant pool lookup is side-effect free in tests.
 */
function makeConnections(sql: Sql): WorkflowTenantConnectionManager {
  return {
    ensureSchema: () => Promise.resolve(sql),
  } as unknown as WorkflowTenantConnectionManager;
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

function querySignature(strings: TemplateStringsArray): string {
  return strings.join("");
}

async function buildRepo(sql: Sql): Promise<WorkflowsRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      WorkflowsRepository,
      {
        provide: WorkflowTenantConnectionManager,
        useValue: makeConnections(sql),
      },
    ],
  }).compile();
  return moduleRef.get(WorkflowsRepository);
}

describe("WorkflowsRepository", () => {
  describe("createDefinition", () => {
    let repo: WorkflowsRepository;

    beforeEach(async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("INSERT INTO workflow_definitions")) {
          return Promise.resolve([definitionRow]);
        }
        return Promise.resolve([]);
      });
      repo = await buildRepo(sql);
    });

    it("inserts a workflow definition and returns the row", async () => {
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

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("db unavailable")));
      const r = await buildRepo(sql);

      await expect(
        r.createDefinition({
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
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (
          q.includes("FROM workflow_definitions") &&
          !q.includes("ORDER BY")
        ) {
          return Promise.resolve([definitionRow]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

      const row = await repo.findDefinitionById("def-1", "t1");
      expect(row?.id).toBe("def-1");
    });

    it("returns undefined when no row", async () => {
      const sql = makeSql(() => Promise.resolve([]));
      const repo = await buildRepo(sql);

      const row = await repo.findDefinitionById("missing", "t1");
      expect(row).toBeUndefined();
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("timeout")));
      const repo = await buildRepo(sql);

      await expect(repo.findDefinitionById("def-1", "t1")).rejects.toThrow(
        "timeout",
      );
    });
  });

  describe("findDefinitionsByTenant (findAll)", () => {
    it("returns ordered list for tenant", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (
          q.includes("FROM workflow_definitions") &&
          q.includes("ORDER BY created_at DESC")
        ) {
          return Promise.resolve([definitionRow]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

      const rows = await repo.findDefinitionsByTenant("t1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("def-1");
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("read failed")));
      const repo = await buildRepo(sql);

      await expect(repo.findDefinitionsByTenant("t1")).rejects.toThrow(
        "read failed",
      );
    });
  });

  describe("softDeleteDefinition", () => {
    it("returns true when a row was updated", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("UPDATE workflow_definitions")) {
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });
      const repo = await buildRepo(sql);

      const ok = await repo.softDeleteDefinition("def-1", "t1");
      expect(ok).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const sql = makeSql(() => Promise.resolve({ count: 0 }));
      const repo = await buildRepo(sql);

      const ok = await repo.softDeleteDefinition("missing", "t1");
      expect(ok).toBe(false);
    });
  });

  describe("createExecution", () => {
    it("inserts an execution and returns the row", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("INSERT INTO workflow_executions")) {
          return Promise.resolve([executionRow]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

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

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("insert failed")));
      const repo = await buildRepo(sql);

      await expect(
        repo.createExecution({
          id: "exe-1",
          definitionId: "def-1",
          tenantId: "t1",
          temporalWorkflowId: "tw-1",
          temporalRunId: "run-1",
          request: {},
        }),
      ).rejects.toThrow("insert failed");
    });
  });

  describe("updateExecutionStatus", () => {
    it("returns true when a row was updated", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("UPDATE workflow_executions")) {
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });
      const repo = await buildRepo(sql);

      const ok = await repo.updateExecutionStatus("exe-1", "t1", "COMPLETED");
      expect(ok).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const sql = makeSql(() => Promise.resolve({ count: 0 }));
      const repo = await buildRepo(sql);

      const ok = await repo.updateExecutionStatus("missing", "t1", "COMPLETED");
      expect(ok).toBe(false);
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("update failed")));
      const repo = await buildRepo(sql);

      await expect(
        repo.updateExecutionStatus("exe-1", "t1", "FAILED"),
      ).rejects.toThrow("update failed");
    });
  });

  describe("findExecutionById", () => {
    it("returns execution when present", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (
          q.includes("FROM workflow_executions") &&
          q.includes("WHERE id =")
        ) {
          return Promise.resolve([executionRow]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

      const row = await repo.findExecutionById("exe-1", "t1");
      expect(row?.id).toBe("exe-1");
    });
  });

  describe("findExecutionsByDefinition", () => {
    it("returns paginated executions for definition", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (
          q.includes("WHERE definition_id =") &&
          q.includes("LIMIT") &&
          q.includes("OFFSET")
        ) {
          return Promise.resolve([executionRow]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

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

    it("supports asc sort", async () => {
      const captured: string[] = [];
      const sql = makeSql((strings) => {
        captured.push(querySignature(strings));
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

      await repo.findExecutionsByDefinition({
        definitionId: "def-1",
        tenantId: "t1",
        limit: 20,
        offset: 40,
        sort: "asc",
      });
      expect(captured.some((q) => q.includes("ORDER BY"))).toBe(true);
    });
  });

  describe("countExecutionsByDefinition", () => {
    it("returns the integer total", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("COUNT(*)::int AS total")) {
          return Promise.resolve([{ total: 7 }]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

      const total = await repo.countExecutionsByDefinition("def-1", "t1");
      expect(total).toBe(7);
    });

    it("returns 0 when there are no rows", async () => {
      const sql = makeSql(() => Promise.resolve([]));
      const repo = await buildRepo(sql);
      const total = await repo.countExecutionsByDefinition("def-1", "t1");
      expect(total).toBe(0);
    });
  });

  describe("countExecutionsGroupedByDefinition", () => {
    it("returns counts grouped by definition_id", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("GROUP BY definition_id")) {
          return Promise.resolve([
            { definition_id: "def-1", count: 3 },
            { definition_id: "def-2", count: 5 },
          ]);
        }
        return Promise.resolve([]);
      });
      const repo = await buildRepo(sql);

      const rows = await repo.countExecutionsGroupedByDefinition("t1");
      expect(rows).toEqual([
        { definition_id: "def-1", count: 3 },
        { definition_id: "def-2", count: 5 },
      ]);
    });
  });
});
