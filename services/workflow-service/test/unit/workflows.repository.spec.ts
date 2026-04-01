import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Sql } from "postgres";
import { WorkflowsRepository } from "../../src/modules/workflows/workflows.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type {
  WorkflowDefinitionRow,
  WorkflowExecutionRow,
} from "../../src/modules/workflows/workflows.repository";

function makeSql(
  impl: (
    strings: TemplateStringsArray,
    values: unknown[],
  ) => Promise<unknown>,
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) =>
    impl(strings, values);
  return Object.assign(fn, {
    json: (x: never) => x,
    unsafe: mock((_q: string, _p: unknown[]) => Promise.resolve(undefined)),
  }) as Sql;
}

const definitionRow: WorkflowDefinitionRow = {
  id: "def-1",
  tenant_id: "t1",
  name: "Flow",
  application: "app",
  actions: [{ activity: "jsFunction", name: "n1", args: { code: "return 1" } }],
  created_at: new Date("2024-06-01T00:00:00.000Z"),
  updated_at: new Date("2024-06-01T00:00:00.000Z"),
  deleted_at: null,
};

const executionRow: WorkflowExecutionRow = {
  id: "exe-1",
  definition_id: "def-1",
  tenant_id: "t1",
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

      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      repo = moduleRef.get(WorkflowsRepository);
    });

    it("inserts a workflow definition and returns the row", async () => {
      const row = await repo.createDefinition(
        "def-1",
        "t1",
        "Flow",
        "app",
        definitionRow.actions as unknown[],
      );
      expect(row.id).toBe("def-1");
      expect(row.tenant_id).toBe("t1");
      expect(row.actions).toEqual(definitionRow.actions);
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() =>
        Promise.reject(new Error("db unavailable")),
      );
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const r = moduleRef.get(WorkflowsRepository);

      await expect(
        r.createDefinition("def-1", "t1", "Flow", "app", []),
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
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const row = await repo.findDefinitionById("def-1", "t1");
      expect(row?.id).toBe("def-1");
    });

    it("returns undefined when no row", async () => {
      const sql = makeSql(() => Promise.resolve([]));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const row = await repo.findDefinitionById("missing", "t1");
      expect(row).toBeUndefined();
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("timeout")));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

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
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const rows = await repo.findDefinitionsByTenant("t1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe("t1");
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("read failed")));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

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
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const ok = await repo.softDeleteDefinition("def-1", "t1");
      expect(ok).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const sql = makeSql(() => Promise.resolve({ count: 0 }));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

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
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const row = await repo.createExecution(
        "exe-1",
        "def-1",
        "t1",
        "tw-1",
        "run-1",
        { orderId: "o1" },
      );
      expect(row.status).toBe("RUNNING");
      expect(row.temporal_workflow_id).toBe("tw-1");
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("insert failed")));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      await expect(
        repo.createExecution("exe-1", "def-1", "t1", "tw-1", "run-1", {}),
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
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const ok = await repo.updateExecutionStatus("exe-1", "COMPLETED");
      expect(ok).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const sql = makeSql(() => Promise.resolve({ count: 0 }));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const ok = await repo.updateExecutionStatus("missing", "COMPLETED");
      expect(ok).toBe(false);
    });

    it("propagates SQL errors", async () => {
      const sql = makeSql(() => Promise.reject(new Error("update failed")));
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      await expect(
        repo.updateExecutionStatus("exe-1", "FAILED"),
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
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const row = await repo.findExecutionById("exe-1", "t1");
      expect(row?.id).toBe("exe-1");
    });
  });

  describe("findExecutionsByDefinition", () => {
    it("returns executions for definition", async () => {
      const sql = makeSql((strings) => {
        const q = querySignature(strings);
        if (q.includes("WHERE definition_id =")) {
          return Promise.resolve([executionRow]);
        }
        return Promise.resolve([]);
      });
      const moduleRef = await Test.createTestingModule({
        providers: [
          WorkflowsRepository,
          { provide: POSTGRES_SQL, useValue: sql },
        ],
      }).compile();
      const repo = moduleRef.get(WorkflowsRepository);

      const rows = await repo.findExecutionsByDefinition("def-1", "t1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.definition_id).toBe("def-1");
    });
  });
});
