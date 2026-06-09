import "../../setup-env";
import { describe, it, expect, beforeEach, vi } from "bun:test";
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
        [],
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
        categories,
      );

      expect(mockSql.unsafe).toHaveBeenCalled();
      const params = mockSql.unsafe.mock.calls[0][1] as any[];
      const categoriesParam = params.find(
        (p) => typeof p === "string" && p.includes("sales"),
      );
      expect(categoriesParam).toBeTruthy();
    });

    it("should batch inserts in groups of 5000", async () => {
      const rows = generateRows(12000);

      await repository.insertRows(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
        FILE_ID,
        rows,
        [],
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
        [],
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
        [],
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
        [],
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
        [],
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
        [],
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
        FILE_ID,
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
        FILE_ID,
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
        FILE_ID,
      );

      expect(rows).toEqual([]);
    });
  });

  describe("deleteRowsByFileId", () => {
    it("should delete rows matching file_id and tenant_id", async () => {
      mockSql.unsafe.mockResolvedValue({ count: 42 });

      await repository.deleteRowsByFileId(
        mockSql,
        TENANT_ID,
        FILE_ID,
      );

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
        FILE_ID,
      );

      expect(deleted).toBe(100);
    });

    it("should return 0 when no rows match", async () => {
      mockSql.unsafe.mockResolvedValue({ count: 0 });

      const deleted = await repository.deleteRowsByFileId(
        mockSql,
        TENANT_ID,
        FILE_ID,
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
        CONTAINER_ID,
      );

      expect(count).toBe(5000);
    });

    it("should return 0 when no rows exist", async () => {
      mockSql.unsafe.mockResolvedValue([{ count: "0" }]);

      const count = await repository.getRowCount(
        mockSql,
        TENANT_ID,
        CONTAINER_ID,
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

  describe("death check", () => {
    it("should throw if container was deleted mid-insert", async () => {
      mockSql.unsafe.mockRejectedValue(
        new Error("container not found or deleted"),
      );

      await expect(
        repository.insertRows(
          mockSql,
          TENANT_ID,
          CONTAINER_ID,
          FILE_ID,
          [{ name: "test" }],
          [],
        ),
      ).rejects.toThrow("container not found or deleted");
    });
  });
});
