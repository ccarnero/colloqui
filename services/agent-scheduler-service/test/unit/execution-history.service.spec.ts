// services/agent-scheduler-service/test/unit/execution-history.service.spec.ts
// ── Validation Suite ─────────────────────────────────────────────────────────
// Full validation for ExecutionHistoryService: Redis-backed execution record
// storage and retrieval.
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

import { ExecutionHistoryService } from "../../src/modules/scheduler/execution-history.service";
import type { ExecutionRecord } from "../../src/modules/scheduler/execution-history.service";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ONE_HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();
const TWO_HOURS_AGO = new Date(Date.now() - 7_200_000).toISOString();
const NOW = new Date().toISOString();

const EXECUTION_RECORDS: ExecutionRecord[] = [
  {
    tenantId: "tenant-1",
    jobId: "job-1",
    executionId: "exec-1",
    triggeredAt: NOW,
    status: "published",
  },
  {
    tenantId: "tenant-1",
    jobId: "job-2",
    executionId: "exec-2",
    triggeredAt: ONE_HOUR_AGO,
    status: "published",
  },
  {
    tenantId: "tenant-2",
    jobId: "job-1",
    executionId: "exec-3",
    triggeredAt: TWO_HOURS_AGO,
    status: "failed",
  },
];

// ── Suite ──────────────────────────────────────────────────────────────────

describe("ExecutionHistoryService", () => {
  let service: ExecutionHistoryService;
  let mockRedisClient: {
    setex: ReturnType<typeof mock>;
    scan: ReturnType<typeof mock>;
    mget: ReturnType<typeof mock>;
  };
  let mockRedisProvider: { client: typeof mockRedisClient };

  beforeEach(() => {
    // Default mock Redis client — no data and a clean scan response
    mockRedisClient = {
      setex: mock(() => Promise.resolve("OK")),
      scan: mock(() => Promise.resolve(["0", []])),
      mget: mock(() => Promise.resolve([])),
    };

    mockRedisProvider = { client: mockRedisClient };

    service = new ExecutionHistoryService(mockRedisProvider as any);
  });

  afterEach(() => {
    // Mocks are recreated fresh in beforeEach
  });

  // ════════════════════════════════════════════════════════════════════════
  //  recordExecution
  // ════════════════════════════════════════════════════════════════════════

  describe("recordExecution", () => {
    it("should store execution with the correct key format and TTL", async () => {
      await service.recordExecution(EXECUTION_RECORDS[0]);

      expect(mockRedisClient.setex).toHaveBeenCalledTimes(1);

      const [key, ttl, value] = mockRedisClient.setex.mock.calls[0] as [
        string,
        number,
        string,
      ];

      expect(key).toContain("scheduler:history:");
      expect(key).toContain("tenant-1");
      expect(key).toContain("job-1");
      expect(key).toContain(EXECUTION_RECORDS[0].triggeredAt);

      const parsed = JSON.parse(value);
      expect(parsed.tenantId).toBe("tenant-1");
      expect(parsed.jobId).toBe("job-1");
      expect(parsed.executionId).toBe("exec-1");
      expect(parsed.status).toBe("published");
    });

    it("should store with a TTL of 7 days (604800 seconds)", async () => {
      await service.recordExecution(EXECUTION_RECORDS[0]);

      const [, ttl] = mockRedisClient.setex.mock.calls[0] as [string, number];
      expect(ttl).toBe(604800);
    });

    it("should handle Redis errors gracefully without throwing", async () => {
      mockRedisClient.setex = mock(() =>
        Promise.reject(new Error("Redis connection lost")),
      );

      await expect(
        service.recordExecution(EXECUTION_RECORDS[0]),
      ).resolves.toBeUndefined();
    });

    it("should store multiple executions with different keys", async () => {
      await service.recordExecution(EXECUTION_RECORDS[0]);
      await service.recordExecution(EXECUTION_RECORDS[2]);

      expect(mockRedisClient.setex).toHaveBeenCalledTimes(2);

      const key1 = (mockRedisClient.setex.mock.calls[0] as [string])[0];
      const key2 = (mockRedisClient.setex.mock.calls[1] as [string])[0];
      expect(key1).not.toBe(key2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  getRecentExecutions
  // ════════════════════════════════════════════════════════════════════════

  describe("getRecentExecutions", () => {
    it("should return an empty array when no history exists", async () => {
      const result = await service.getRecentExecutions();

      expect(result).toEqual([]);
      expect(mockRedisClient.scan).toHaveBeenCalledTimes(1);
    });

    it("should return execution records when keys exist", async () => {
      const keys = [
        "scheduler:history:tenant-1:job-1:2025-01-02T00:00:00Z",
        "scheduler:history:tenant-2:job-1:2025-01-01T00:00:00Z",
      ];
      const records = [
        { ...EXECUTION_RECORDS[0], triggeredAt: "2025-01-02T00:00:00Z", tenantId: "tenant-1" },
        { ...EXECUTION_RECORDS[0], triggeredAt: "2025-01-01T00:00:00Z", tenantId: "tenant-2" },
      ];
      const values = records.map((r) => JSON.stringify(r));

      mockRedisClient.scan = mock(() => Promise.resolve(["0", keys]));
      mockRedisClient.mget = mock(() => Promise.resolve(values));

      const result = await service.getRecentExecutions();

      expect(result).toHaveLength(2);
      // Sorted by triggeredAt descending: Jan 2 (tenant-1) first, Jan 1 (tenant-2) second
      expect(result[0].tenantId).toBe("tenant-1");
      expect(result[1].tenantId).toBe("tenant-2");
    });

    it("should return records sorted by triggeredAt descending (newest first)", async () => {
      const keys = [
        "scheduler:history:tenant-1:job-1:2025-01-03T00:00:00Z",
        "scheduler:history:tenant-1:job-1:2025-01-01T00:00:00Z",
        "scheduler:history:tenant-1:job-1:2025-01-02T00:00:00Z",
      ];
      const records = [
        { ...EXECUTION_RECORDS[0], triggeredAt: "2025-01-03T00:00:00Z" },
        { ...EXECUTION_RECORDS[0], triggeredAt: "2025-01-01T00:00:00Z" },
        { ...EXECUTION_RECORDS[0], triggeredAt: "2025-01-02T00:00:00Z" },
      ];
      const values = records.map((r) => JSON.stringify(r));

      mockRedisClient.scan = mock(() => Promise.resolve(["0", keys]));
      mockRedisClient.mget = mock(() => Promise.resolve(values));

      const result = await service.getRecentExecutions();

      expect(result).toHaveLength(3);
      // Should be sorted newest first
      expect(result[0].triggeredAt).toBe("2025-01-03T00:00:00Z");
      expect(result[1].triggeredAt).toBe("2025-01-02T00:00:00Z");
      expect(result[2].triggeredAt).toBe("2025-01-01T00:00:00Z");
    });

    it("should respect the limit parameter and not return more than requested", async () => {
      const keys = Array.from(
        { length: 10 },
        (_, i) => `scheduler:history:tenant-1:job-1:2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      );
      const records = keys.map((_, i) => ({
        ...EXECUTION_RECORDS[0],
        triggeredAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      }));
      const allValues = records.map((r) => JSON.stringify(r));

      // Single scan page with 10 keys
      mockRedisClient.scan = mock(() => Promise.resolve(["0", keys]));
      // Return values that correspond ONLY to the keys passed to mget
      mockRedisClient.mget = mock((...args: string[]) => {
        const passedKeys = args as string[];
        return Promise.resolve(passedKeys.map((k) => {
          const idx = keys.indexOf(k);
          return idx >= 0 ? allValues[idx] : null;
        }));
      });

      const result = await service.getRecentExecutions(5);

      // Should return at most 5
      expect(result.length).toBe(5);
    });

    it("should handle Redis scan errors gracefully", async () => {
      mockRedisClient.scan = mock(() =>
        Promise.reject(new Error("Redis not available")),
      );

      const result = await service.getRecentExecutions();

      expect(result).toEqual([]);
    });

    it("should handle malformed JSON values gracefully by skipping them", async () => {
      const keys = ["scheduler:history:t1:j1:2025-01-01T00:00:00Z"];
      const values = ["{invalid-json}"];

      mockRedisClient.scan = mock(() => Promise.resolve(["0", keys]));
      mockRedisClient.mget = mock(() => Promise.resolve(values));

      const result = await service.getRecentExecutions();

      expect(result).toEqual([]);
    });
  });
});
