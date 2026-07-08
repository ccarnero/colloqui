import "../../setup-env";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { SKBQueryHistoryRecord } from "../../../src/modules/structured-kb/skb-query-history.service";
import { SKBQueryHistoryService } from "../../../src/modules/structured-kb/skb-query-history.service";

const TENANT_ID = "tenant-123";
const CONTAINER_ID = "container-abc";
const USER_ID = "user-xyz";

function buildRecord(
  overrides: Partial<SKBQueryHistoryRecord> = {}
): SKBQueryHistoryRecord {
  return {
    id: "record-1",
    tenant_id: TENANT_ID,
    container_id: CONTAINER_ID,
    nl_query: "show me all sales from Q1",
    generated_sql:
      "SELECT * FROM skb_rows WHERE (data->>'quarter')::text = 'Q1'",
    result_count: 42,
    duration_ms: 150,
    error: null,
    user_id: USER_ID,
    created_at: new Date("2026-06-01T12:00:00Z"),
    ...overrides,
  };
}

describe("SKBQueryHistoryService", () => {
  let service: SKBQueryHistoryService;
  let mockRepository: {
    recordQuery: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
    getRecentQueries: ReturnType<typeof vi.fn>;
    getStats: ReturnType<typeof vi.fn>;
    deleteOlderThan: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepository = {
      recordQuery: vi.fn(),
      getHistory: vi.fn(),
      getRecentQueries: vi.fn(),
      getStats: vi.fn(),
      deleteOlderThan: vi.fn(),
    };

    service = new SKBQueryHistoryService(mockRepository as any);
  });

  describe("recordQuery", () => {
    it("should store a query history record and return it", async () => {
      const expected = buildRecord();
      mockRepository.recordQuery.mockResolvedValue(expected);

      const result = await service.recordQuery(
        TENANT_ID,
        CONTAINER_ID,
        "show me all sales from Q1",
        "SELECT * FROM skb_rows WHERE (data->>'quarter')::text = 'Q1'",
        42,
        150,
        USER_ID
      );

      expect(result).toEqual(expected);
      expect(mockRepository.recordQuery).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "show me all sales from Q1",
        "SELECT * FROM skb_rows WHERE (data->>'quarter')::text = 'Q1'",
        42,
        150,
        null,
        USER_ID,
        undefined,
        null,
        null,
        null
      );
    });

    it("should record query with error when provided", async () => {
      const expected = buildRecord({
        error: "SQL safety violation",
        result_count: 0,
      });
      mockRepository.recordQuery.mockResolvedValue(expected);

      const result = await service.recordQuery(
        TENANT_ID,
        CONTAINER_ID,
        "drop table skb_rows",
        "DROP TABLE skb_rows",
        0,
        5,
        null,
        null,
        "SQL safety violation"
      );

      expect(result.error).toBe("SQL safety violation");
      expect(mockRepository.recordQuery).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "drop table skb_rows",
        "DROP TABLE skb_rows",
        0,
        5,
        null,
        null,
        "SQL safety violation",
        null,
        null,
        null
      );
    });

    it("should record query without user_id", async () => {
      const expected = buildRecord({ user_id: null });
      mockRepository.recordQuery.mockResolvedValue(expected);

      const result = await service.recordQuery(
        TENANT_ID,
        CONTAINER_ID,
        "show me all sales",
        "SELECT * FROM skb_rows",
        10,
        80
      );

      expect(result.user_id).toBeNull();
      expect(mockRepository.recordQuery).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "show me all sales",
        "SELECT * FROM skb_rows",
        10,
        80,
        null,
        undefined,
        undefined,
        null,
        null,
        null
      );
    });

    it("threads correlation/causation/execution ids through to the repository when provided", async () => {
      const expected = buildRecord();
      mockRepository.recordQuery.mockResolvedValue(expected);

      await service.recordQuery(
        TENANT_ID,
        CONTAINER_ID,
        "show me all sales from Q1",
        "SELECT * FROM skb_rows WHERE (data->>'quarter')::text = 'Q1'",
        42,
        150,
        USER_ID,
        undefined,
        undefined,
        {
          correlationId: "conv-1",
          causationId: "cause-1",
          executionId: "exec-1",
        }
      );

      expect(mockRepository.recordQuery).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        "show me all sales from Q1",
        "SELECT * FROM skb_rows WHERE (data->>'quarter')::text = 'Q1'",
        42,
        150,
        null,
        USER_ID,
        undefined,
        "conv-1",
        "cause-1",
        "exec-1"
      );
    });
  });

  describe("getQueryHistory", () => {
    it("should return paginated history for a container", async () => {
      const records = [
        buildRecord({ id: "r1" }),
        buildRecord({ id: "r2", nl_query: "top products" }),
      ];
      mockRepository.getHistory.mockResolvedValue(records);

      const result = await service.getQueryHistory(
        TENANT_ID,
        CONTAINER_ID,
        10,
        0
      );

      expect(result).toEqual(records);
      expect(result).toHaveLength(2);
      expect(mockRepository.getHistory).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        10,
        0
      );
    });

    it("should use default limit and offset when not provided", async () => {
      mockRepository.getHistory.mockResolvedValue([]);

      await service.getQueryHistory(TENANT_ID, CONTAINER_ID);

      expect(mockRepository.getHistory).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        50,
        0
      );
    });

    it("should return records ordered by most recent first", async () => {
      const newest = buildRecord({
        id: "r-newest",
        created_at: new Date("2026-06-08T12:00:00Z"),
      });
      const oldest = buildRecord({
        id: "r-oldest",
        created_at: new Date("2026-06-01T12:00:00Z"),
      });
      mockRepository.getHistory.mockResolvedValue([newest, oldest]);

      const result = await service.getQueryHistory(TENANT_ID, CONTAINER_ID);

      expect(result[0].id).toBe("r-newest");
      expect(result[1].id).toBe("r-oldest");
    });

    it("should return empty array when no history exists", async () => {
      mockRepository.getHistory.mockResolvedValue([]);

      const result = await service.getQueryHistory(TENANT_ID, CONTAINER_ID);

      expect(result).toEqual([]);
    });
  });

  describe("getRecentQueries", () => {
    it("should return queries within the default time window (24h)", async () => {
      const recent = buildRecord({ id: "recent-1" });
      mockRepository.getRecentQueries.mockResolvedValue([recent]);

      const result = await service.getRecentQueries(TENANT_ID, CONTAINER_ID);

      expect(result).toHaveLength(1);
      expect(mockRepository.getRecentQueries).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        24
      );
    });

    it("should accept a custom hours parameter", async () => {
      mockRepository.getRecentQueries.mockResolvedValue([]);

      await service.getRecentQueries(TENANT_ID, CONTAINER_ID, 72);

      expect(mockRepository.getRecentQueries).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        72
      );
    });

    it("should return empty array when no recent queries exist", async () => {
      mockRepository.getRecentQueries.mockResolvedValue([]);

      const result = await service.getRecentQueries(
        TENANT_ID,
        CONTAINER_ID,
        48
      );

      expect(result).toEqual([]);
    });
  });

  describe("getQueryStats", () => {
    it("should return aggregate stats for a container", async () => {
      const stats = {
        total_queries: 150,
        avg_duration_ms: 120.5,
        error_rate: 0.03,
      };
      mockRepository.getStats.mockResolvedValue(stats);

      const result = await service.getQueryStats(TENANT_ID, CONTAINER_ID);

      expect(result.total_queries).toBe(150);
      expect(result.avg_duration_ms).toBe(120.5);
      expect(result.error_rate).toBe(0.03);
      expect(mockRepository.getStats).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID
      );
    });

    it("should return zeroed stats when no queries exist", async () => {
      const emptyStats = {
        total_queries: 0,
        avg_duration_ms: 0,
        error_rate: 0,
      };
      mockRepository.getStats.mockResolvedValue(emptyStats);

      const result = await service.getQueryStats(TENANT_ID, CONTAINER_ID);

      expect(result.total_queries).toBe(0);
      expect(result.avg_duration_ms).toBe(0);
      expect(result.error_rate).toBe(0);
    });
  });

  describe("deleteQueryHistory", () => {
    it("should delete records older than the specified date", async () => {
      const olderThan = new Date("2026-05-01T00:00:00Z");
      mockRepository.deleteOlderThan.mockResolvedValue(25);

      const deleted = await service.deleteQueryHistory(
        TENANT_ID,
        CONTAINER_ID,
        olderThan
      );

      expect(deleted).toBe(25);
      expect(mockRepository.deleteOlderThan).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        olderThan
      );
    });

    it("should return 0 when no records match the deletion criteria", async () => {
      mockRepository.deleteOlderThan.mockResolvedValue(0);

      const deleted = await service.deleteQueryHistory(
        TENANT_ID,
        CONTAINER_ID,
        new Date("2026-01-01T00:00:00Z")
      );

      expect(deleted).toBe(0);
    });

    it("should delete all records for the container when olderThan is not provided", async () => {
      mockRepository.deleteOlderThan.mockResolvedValue(100);

      const deleted = await service.deleteQueryHistory(TENANT_ID, CONTAINER_ID);

      expect(mockRepository.deleteOlderThan).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID,
        undefined
      );
    });
  });

  describe("error handling", () => {
    it("should throw a descriptive error when DB fails on recordQuery", async () => {
      mockRepository.recordQuery.mockRejectedValue(
        new Error("Connection refused")
      );

      await expect(
        service.recordQuery(
          TENANT_ID,
          CONTAINER_ID,
          "test query",
          "SELECT 1",
          0,
          10
        )
      ).rejects.toThrow("Connection refused");
    });

    it("should throw a descriptive error when DB fails on getQueryHistory", async () => {
      mockRepository.getHistory.mockRejectedValue(
        new Error("Timeout: connection pool exhausted")
      );

      await expect(
        service.getQueryHistory(TENANT_ID, CONTAINER_ID)
      ).rejects.toThrow("Timeout: connection pool exhausted");
    });

    it("should throw a descriptive error when DB fails on getQueryStats", async () => {
      mockRepository.getStats.mockRejectedValue(
        new Error("Relation skb_query_history does not exist")
      );

      await expect(
        service.getQueryStats(TENANT_ID, CONTAINER_ID)
      ).rejects.toThrow("Relation skb_query_history does not exist");
    });

    it("should throw a descriptive error when DB fails on deleteQueryHistory", async () => {
      mockRepository.deleteOlderThan.mockRejectedValue(
        new Error("Deadlock detected")
      );

      await expect(
        service.deleteQueryHistory(TENANT_ID, CONTAINER_ID)
      ).rejects.toThrow("Deadlock detected");
    });
  });
});
