import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Sql } from "postgres";
import { ExecutionsService } from "../../src/modules/executions/executions.service";
import { TenantConnectionManager } from "../../src/providers/tenant-connection-manager";

function createQueuedSql(rowsQueue: unknown[][]) {
  const fn = mock(() => {
    const next = rowsQueue.shift();
    return Promise.resolve(next ?? []);
  });
  return Object.assign(fn, {
    json: (v: unknown) => v,
  }) as unknown as Sql;
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    schedule_id: "sched-1",
    status: "completed",
    started_at: "2020-01-01T00:00:00.000Z",
    completed_at: "2020-01-01T00:00:01.000Z",
    duration_ms: 1000,
    output: "",
    error: "",
    metadata: {},
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ExecutionsService", () => {
  let service: ExecutionsService;
  let sqlQueue: unknown[][];
  let mockSql: Sql;

  beforeEach(async () => {
    sqlQueue = [];
    mockSql = createQueuedSql(sqlQueue);
    const tenantConnections = {
      ensureSchema: mock(() => Promise.resolve(mockSql)),
    };

    const module = await Test.createTestingModule({
      providers: [
        ExecutionsService,
        { provide: TenantConnectionManager, useValue: tenantConnections },
      ],
    }).compile();

    service = module.get(ExecutionsService);
  });

  describe("findByScheduleId", () => {
    it("returns executions for schedule", async () => {
      sqlQueue.push([], [logRow(), logRow({ id: "log-2" })]);
      const result = await service.findByScheduleId(
        "sched-1",
        { limit: 20, offset: 0 },
        "tenant-a",
      );
      expect(result.executions).toHaveLength(2);
      expect(result.executions[0].schedule_id).toBe("sched-1");
    });
  });

  describe("findAll", () => {
    it("returns paginated execution logs", async () => {
      sqlQueue.push([], [logRow()]);
      const result = await service.findAll(
        { limit: 5, offset: 0, status: "completed" },
        "tenant-a",
      );
      expect(result.executions).toHaveLength(1);
      expect(result.limit).toBe(5);
    });
  });

  describe("findById", () => {
    it("returns null when not found", async () => {
      sqlQueue.push([]);
      const row = await service.findById("missing", "tenant-a");
      expect(row).toBeNull();
    });

    it("returns log when present", async () => {
      sqlQueue.push([logRow()]);
      const row = await service.findById("log-1", "tenant-a");
      expect(row?.id).toBe("log-1");
    });
  });
});
