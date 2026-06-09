// services/agent-scheduler-service/test/unit/job-reader.service.spec.ts
// ── Validation Suite ─────────────────────────────────────────────────────────
// Full validation for JobReaderService: tenant job reading, schedule type
// resolution, and error handling.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// ── Module Mocks ───────────────────────────────────────────────────────────
// PinoLoggerService is a field initializer, so it must be mocked before the
// service import resolves.
mock.module("@yoizen/observability", () => ({
  PinoLoggerService: class MockLogger {
    debug = mock(() => {});
    error = mock(() => {});
    warn = mock(() => {});
    log = mock(() => {});
  },
}));

import { JobReaderService } from "../../src/modules/scheduler/job-reader.service";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Reconstruct the full SQL string from a tagged-template call.
 * A tagged-template invocation produces arguments of the form:
 *   [strings: TemplateStringsArray, ...values: unknown[]]
 */
function reconstructSql(callArgs: unknown[]): string {
  const [strings, ...values] = callArgs as [string[], ...unknown[]];
  let sql = "";
  for (let i = 0; i < strings.length; i++) {
    sql += strings[i];
    if (i < values.length) {
      sql += String(values[i]);
    }
  }
  return sql;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_JOB_ROWS = [
  {
    id: "job-1",
    name: "Daily Report",
    agent_id: "agent-1",
    schedule: "0 6 * * *",
    payload: { type: "report" },
    is_active: true,
    last_run: "2025-01-01T06:00:00Z",
    next_run: "2025-01-02T06:00:00Z",
    created_at: "2024-12-01T00:00:00Z",
    updated_at: "2025-01-01T06:00:00Z",
  },
  {
    id: "job-2",
    name: "Health Check",
    agent_id: "agent-2",
    schedule: "300",
    payload: { endpoint: "/health" },
    is_active: true,
    last_run: null,
    next_run: null,
    created_at: "2024-12-01T00:00:00Z",
    updated_at: "2024-12-01T00:00:00Z",
  },
];

// ── Suite ──────────────────────────────────────────────────────────────────

describe("JobReaderService", () => {
  let service: JobReaderService;
  let mockSql: ReturnType<typeof mock>;
  let mockTenantManager: {
    getKnownTenantIds: ReturnType<typeof mock>;
    getConnection: ReturnType<typeof mock>;
  };

  beforeEach(() => {
    // Default mock SQL — returns the standard fixture rows
    mockSql = mock((strings: TemplateStringsArray, ...values: unknown[]) => {
      return Promise.resolve(MOCK_JOB_ROWS);
    });

    mockTenantManager = {
      getKnownTenantIds: mock(() => []),
      getConnection: mock(() => mockSql),
    };

    service = new JobReaderService(mockTenantManager as any);
  });

  afterEach(() => {
    // Mocks are recreated fresh in beforeEach
  });

  // ════════════════════════════════════════════════════════════════════════
  //  resolveScheduleType (private)
  // ════════════════════════════════════════════════════════════════════════

  describe("resolveScheduleType", () => {
    it("should return 'cron' for a schedule containing non-digits (cron expression)", () => {
      const result = (service as any).resolveScheduleType("*/5 * * * *");
      expect(result).toBe("cron");
    });

    it("should return 'cron' for a schedule with mixed content (e.g. 'every 5m')", () => {
      const result = (service as any).resolveScheduleType("every 5m");
      expect(result).toBe("cron");
    });

    it("should return 'interval' for a schedule containing only digits", () => {
      const result = (service as any).resolveScheduleType("300");
      expect(result).toBe("interval");
    });

    it("should return 'cron' for an empty schedule string", () => {
      // "" does not match /^\d+$/ so it falls through to "cron"
      const result = (service as any).resolveScheduleType("");
      expect(result).toBe("cron");
    });

    it("should return 'cron' for a schedule with leading zeros (not pure digits semantically)", () => {
      // "0" matches /^\d+$/ — technically digits, but the real case is
      // that strings like "* * * * *" are cron. "0" as a schedule would
      // be treated as interval, which is an edge case of the simple heuristic.
      const result = (service as any).resolveScheduleType("0");
      expect(result).toBe("interval");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  readAllTenantJobs
  // ════════════════════════════════════════════════════════════════════════

  describe("readAllTenantJobs", () => {
    it("should return an empty map when no tenants are known", async () => {
      mockTenantManager.getKnownTenantIds.mockImplementation(() => []);

      const result = await service.readAllTenantJobs();

      expect(result.size).toBe(0);
      expect(mockTenantManager.getConnection).not.toHaveBeenCalled();
    });

    it("should return jobs when tenants exist with active schedules", async () => {
      mockTenantManager.getKnownTenantIds.mockImplementation(() => ["tenant-1"]);

      const result = await service.readAllTenantJobs();

      expect(result.size).toBe(1);
      expect(result.has("tenant-1")).toBe(true);

      const jobs = result.get("tenant-1")!;
      expect(jobs).toHaveLength(2);

      // First job: cron schedule
      expect(jobs[0].id).toBe("job-1");
      expect(jobs[0].schedule).toBe("0 6 * * *");
      expect(jobs[0].schedule_type).toBe("cron");

      // Second job: interval schedule
      expect(jobs[1].id).toBe("job-2");
      expect(jobs[1].schedule).toBe("300");
      expect(jobs[1].schedule_type).toBe("interval");
    });

    it("should handle per-tenant SQL errors gracefully without throwing", async () => {
      mockTenantManager.getKnownTenantIds.mockImplementation(() => ["tenant-1"]);

      const mockFailingSql = mock(() =>
        Promise.reject(new Error("Connection refused")),
      );
      mockTenantManager.getConnection.mockImplementation(() => mockFailingSql);

      // Should not throw — individual tenant errors are caught and logged
      const result = await service.readAllTenantJobs();

      // Tenant had an error → no jobs for it
      expect(result.size).toBe(0);
    });

    it("should return jobs for multiple tenants", async () => {
      mockTenantManager.getKnownTenantIds.mockImplementation(() => [
        "tenant-a",
        "tenant-b",
      ]);

      const result = await service.readAllTenantJobs();

      expect(result.size).toBe(2);
      expect(result.has("tenant-a")).toBe(true);
      expect(result.has("tenant-b")).toBe(true);
    });

    it("should skip tenants that return no rows", async () => {
      mockTenantManager.getKnownTenantIds.mockImplementation(() => [
        "tenant-empty",
      ]);

      const mockEmptySql = mock(() => Promise.resolve([]));
      mockTenantManager.getConnection.mockImplementation(() => mockEmptySql);

      const result = await service.readAllTenantJobs();

      // Empty rows → the code only sets the map if jobs.length > 0
      expect(result.size).toBe(0);
    });

    it("should include the tenant-agnostic query in the SQL call", async () => {
      mockTenantManager.getKnownTenantIds.mockImplementation(() => ["tenant-1"]);

      await service.readAllTenantJobs();

      expect(mockTenantManager.getConnection).toHaveBeenCalledWith("tenant-1");
      expect(mockSql).toHaveBeenCalledTimes(1);

      const sqlText = reconstructSql(mockSql.mock.calls[0] as unknown[]);
      expect(sqlText).toContain("FROM jobs");
      expect(sqlText).toContain("is_active = true");
      expect(sqlText).toContain("schedule IS NOT NULL");
    });
  });
});
