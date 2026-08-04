import "../../setup-env";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { SKBRowsRepository } from "../../src/modules/structured-kb/skb-rows.repository";

describe("SKBRowsRepository", () => {
  let repository: SKBRowsRepository;
  let mockSql: any;

  const TENANT_ID = "tenant-123";
  const CONTAINER_ID = "container-abc";
  const FILE_ID = "file-xyz";

  function createMockSql(): any {
    return {
      unsafe: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([]),
    };
  }

  function generateRows(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, i) => ({
      name: `Row ${i}`,
      value: i * 10,
    }));
  }

  beforeEach(() => {
    repository = new SKBRowsRepository();
    mockSql = createMockSql();
  });

  describe("insertRows", () => {
    it("should insert rows with tenant, container, and file metadata", async () => {
      const rows = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];

      await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        []
      );

      expect(mockSql.unsafe).toHaveBeenCalled();
      const callArgs = mockSql.unsafe.mock.calls[0];
      const sql = callArgs[0];
      expect(sql).toContain("INSERT INTO skb_rows");
      expect(sql).toContain("container_id");
      expect(sql).toContain("file_id");
      expect(sql).toContain("tenant_id");
    });

    it("should insert categories as JSONB", async () => {
      const rows = [{ name: "Alice" }];
      const categories = ["sales", "q1"];

      await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        categories
      );

      expect(mockSql.unsafe).toHaveBeenCalled();
      const params = mockSql.unsafe.mock.calls[0][1] as any[];
      // Raw array (not pre-stringified): the $n::jsonb cast has the driver
      // serialize it — a string param here would double-encode in Postgres.
      const categoriesParam = params.find((p) => Array.isArray(p));
      expect(categoriesParam).toEqual(categories);
    });

    it("should batch inserts in groups of 5000", async () => {
      const rows = generateRows(12000);

      await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        []
      );

      expect(mockSql.unsafe).toHaveBeenCalledTimes(3);
    });

    it("should return the number of inserted rows", async () => {
      const rows = generateRows(100);

      const count = await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        []
      );

      expect(count).toBe(100);
    });

    it("should handle single row", async () => {
      const rows = [{ name: "Only One" }];

      const count = await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        []
      );

      expect(count).toBe(1);
      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
    });

    it("should handle empty rows array", async () => {
      const count = await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        [],
        []
      );

      expect(count).toBe(0);
      expect(mockSql.unsafe).not.toHaveBeenCalled();
    });

    it("should handle exactly 5000 rows as a single batch", async () => {
      const rows = generateRows(5000);

      await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        []
      );

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
    });

    it("should handle 5001 rows as two batches", async () => {
      const rows = generateRows(5001);

      await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        []
      );

      expect(mockSql.unsafe).toHaveBeenCalledTimes(2);
    });
  });

  describe("getRows", () => {
    it("should query rows by tenant, container, and file", async () => {
      mockSql.unsafe.mockResolvedValue([
        { data: { name: "Alice" } },
        { data: { name: "Bob" } },
      ]);

      const rows = await repository.getRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID
      );

      expect(mockSql.unsafe).toHaveBeenCalled();
      const sql = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sql).toContain("skb_rows");
      expect(sql).toContain("tenant_id");
      expect(sql).toContain("container_id");
      expect(sql).toContain("file_id");
    });

    it("should return data column from each row", async () => {
      mockSql.unsafe.mockResolvedValue([
        { data: { name: "Alice", age: 30 } },
        { data: { name: "Bob", age: 25 } },
      ]);

      const rows = await repository.getRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID
      );

      expect(rows).toEqual([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ]);
    });

    it("should return empty array when no rows found", async () => {
      mockSql.unsafe.mockResolvedValue([]);

      const rows = await repository.getRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID
      );

      expect(rows).toEqual([]);
    });
  });

  describe("deleteRowsByFileId", () => {
    it("should delete rows matching file_id and tenant_id", async () => {
      mockSql.unsafe.mockResolvedValue({ count: 42 });

      await repository.deleteRowsByFileId(mockSql, TENANT_ID, FILE_ID);

      expect(mockSql.unsafe).toHaveBeenCalled();
      const sql = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sql).toContain("DELETE FROM skb_rows");
      expect(sql).toContain("file_id");
      expect(sql).toContain("tenant_id");
    });

    it("should return the number of deleted rows", async () => {
      mockSql.unsafe.mockResolvedValue({ count: 100 });

      const deleted = await repository.deleteRowsByFileId(
        mockSql,
        TENANT_ID,
        FILE_ID
      );

      expect(deleted).toBe(100);
    });

    it("should return 0 when no rows match", async () => {
      mockSql.unsafe.mockResolvedValue({ count: 0 });

      const deleted = await repository.deleteRowsByFileId(
        mockSql,
        TENANT_ID,
        FILE_ID
      );

      expect(deleted).toBe(0);
    });
  });

  describe("getRowCount", () => {
    it("should return count for a container and tenant", async () => {
      mockSql.unsafe.mockResolvedValue([{ count: "5000" }]);

      const count = await repository.getRowCount(
        mockSql,
        TENANT_ID,
        CONTAINER_ID
      );

      expect(count).toBe(5000);
    });

    it("should return 0 when no rows exist", async () => {
      mockSql.unsafe.mockResolvedValue([{ count: "0" }]);

      const count = await repository.getRowCount(
        mockSql,
        TENANT_ID,
        CONTAINER_ID
      );

      expect(count).toBe(0);
    });

    it("should query skb_rows with container_id and tenant_id", async () => {
      mockSql.unsafe.mockResolvedValue([{ count: "10" }]);

      await repository.getRowCount(mockSql, TENANT_ID, CONTAINER_ID);

      const sql = mockSql.unsafe.mock.calls[0][0] as string;
      expect(sql).toContain("COUNT");
      expect(sql).toContain("skb_rows");
      expect(sql).toContain("container_id");
      expect(sql).toContain("tenant_id");
    });
  });

  describe("executeQuery", () => {
    function createRepositoryWithSql(sql: any): SKBRowsRepository {
      const connectionManager = {
        ensureSchema: vi.fn().mockResolvedValue(sql),
      };
      return new SKBRowsRepository(connectionManager as any);
    }

    it("should parameterize containerId and tenantId instead of interpolating them", async () => {
      mockSql.unsafe.mockResolvedValue([]);
      const repo = createRepositoryWithSql(mockSql);

      await repo.executeQuery(TENANT_ID, CONTAINER_ID, {
        whereClause: "",
        categories: [],
        limit: 10,
        offset: 0,
      });

      const [dataSql, dataParams] = mockSql.unsafe.mock.calls[0];
      expect(dataSql).not.toContain(CONTAINER_ID);
      expect(dataSql).not.toContain(TENANT_ID);
      expect(dataSql).toContain("container_id = $1");
      expect(dataSql).toContain("tenant_id = $2");
      expect(dataParams).toContain(CONTAINER_ID);
      expect(dataParams).toContain(TENANT_ID);
    });

    it("should neutralize a SQL-injection payload in containerId as a literal parameter value", async () => {
      mockSql.unsafe.mockResolvedValue([]);
      const repo = createRepositoryWithSql(mockSql);
      const malicious = "x' OR '1'='1";

      await repo.executeQuery(TENANT_ID, malicious, {
        whereClause: "",
        categories: [],
        limit: 10,
        offset: 0,
      });

      const [dataSql, dataParams] = mockSql.unsafe.mock.calls[0];
      // The query text must stay structurally fixed — the payload never
      // becomes part of the SQL grammar, only a bound value.
      expect(dataSql).toContain("container_id = $1");
      expect(dataSql).not.toContain("OR '1'='1");
      expect(dataParams[0]).toBe(malicious);
    });

    it("should parameterize categories instead of interpolating a JSON literal", async () => {
      mockSql.unsafe.mockResolvedValue([]);
      const repo = createRepositoryWithSql(mockSql);
      const categories = ["a' OR '1'='1", "sales"];

      await repo.executeQuery(TENANT_ID, CONTAINER_ID, {
        whereClause: "",
        categories,
        limit: 10,
        offset: 0,
      });

      const [dataSql, dataParams] = mockSql.unsafe.mock.calls[0];
      expect(dataSql).not.toContain("OR '1'='1");
      expect(dataSql).toContain("categories @>");
      const categoriesParam = (dataParams as unknown[]).find((p) =>
        Array.isArray(p)
      );
      expect(categoriesParam).toEqual(categories);
    });

    it("should still splice the pre-validated whereClause/orderBy as raw SQL text", async () => {
      mockSql.unsafe.mockResolvedValue([]);
      const repo = createRepositoryWithSql(mockSql);

      await repo.executeQuery(TENANT_ID, CONTAINER_ID, {
        whereClause: "(data->>'status') = 'active'",
        orderBy: "(data->>'created_at') DESC",
        categories: [],
        limit: 10,
        offset: 0,
      });

      const [dataSql] = mockSql.unsafe.mock.calls[0];
      expect(dataSql).toContain("(data->>'status') = 'active'");
      expect(dataSql).toContain("ORDER BY (data->>'created_at') DESC");
    });

    it("should return mapped results and total count", async () => {
      const repo = createRepositoryWithSql(mockSql);
      mockSql.unsafe
        .mockResolvedValueOnce([{ data: { name: "Alice" } }])
        .mockResolvedValueOnce([{ count: "1" }]);

      const result = await repo.executeQuery(TENANT_ID, CONTAINER_ID, {
        whereClause: "",
        categories: [],
        limit: 10,
        offset: 0,
      });

      expect(result.results).toEqual([{ name: "Alice" }]);
      expect(result.totalCount).toBe(1);
    });
  });

  describe("death check", () => {
    it("should throw if container was deleted mid-insert", async () => {
      mockSql.unsafe.mockRejectedValue(
        new Error("container not found or deleted")
      );

      await expect(
        repository.insertRows(
          mockSql,
          TENANT_ID,
          CONTAINER_ID,
          FILE_ID,
          [{ name: "test" }],
          []
        )
      ).rejects.toThrow("container not found or deleted");
    });
  });
});
