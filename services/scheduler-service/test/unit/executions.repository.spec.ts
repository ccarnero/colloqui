import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import type { Sql } from "postgres";
import { ExecutionsRepository } from "../../src/modules/executions/executions.repository";
import { TenantConnectionManager } from "../../src/providers/tenant-connection-manager";

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    schedule_id: "s1",
    status: "pending",
    started_at: "2020-01-01T00:00:00.000Z",
    completed_at: null,
    duration_ms: null,
    output: "",
    error: "",
    metadata: {},
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ExecutionsRepository", () => {
  async function compileWithSql(sql: Sql) {
    const tenantConnections = {
      ensureSchema: mock(() => Promise.resolve(sql)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionsRepository,
        {
          provide: TenantConnectionManager,
          useValue: tenantConnections,
        },
      ],
    }).compile();
    return moduleRef.get(ExecutionsRepository);
  }

  it("createLog inserts pending execution", async () => {
    const sql = createQueuedSql([[logRow()]], mock);
    const repo = await compileWithSql(sql);
    const row = await repo.createLog("s1", "tenant-a");
    expect(row.schedule_id).toBe("s1");
    expect(row.status).toBe("pending");
    expect(sql).toHaveBeenCalled();
  });

  it("findById returns matching log", async () => {
    const sql = createQueuedSql([[logRow()]], mock);
    const repo = await compileWithSql(sql);
    const row = await repo.findById("e1", "tenant-a");
    expect(row?.id).toBe("e1");
    expect(sql).toHaveBeenCalled();
  });

  it("findAll returns executions with limit and offset", async () => {
    const sql = createQueuedSql([[], [logRow(), logRow({ id: "e2" })]], mock);
    const repo = await compileWithSql(sql);
    const result = await repo.findAll(
      { limit: 10, offset: 0, status: "pending" },
      "tenant-a",
    );
    expect(result.executions).toHaveLength(2);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });

  it("findByScheduleId filters by schedule_id", async () => {
    const sql = createQueuedSql([[], [logRow()]], mock);
    const repo = await compileWithSql(sql);
    const result = await repo.findByScheduleId(
      "s1",
      { limit: 5, offset: 0 },
      "tenant-a",
    );
    expect(result.executions).toHaveLength(1);
    expect(result.executions[0]?.schedule_id).toBe("s1");
  });

  it("updateStatus returns updated row", async () => {
    const sql = createQueuedSql([[], [logRow({ status: "failed", error: "x" })]], mock);
    const repo = await compileWithSql(sql);
    const row = await repo.updateStatus({
      id: "e1",
      tenantId: "tenant-a",
      status: "failed",
      error: "x",
    });
    expect(row.status).toBe("failed");
  });
});
