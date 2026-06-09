import "../../setup-env";
import { describe, it, expect, beforeEach, vi } from "bun:test";
import { SKBRowIndexService } from "../../src/modules/structured-kb/skb-row-index.service";
import type { SchemaAnalysisResult } from "../../src/modules/structured-kb/types/skb.types";

function createMockSqlProvider() {
  const unsafe = vi.fn().mockResolvedValue([]);
  return {
    getSql: vi.fn().mockResolvedValue({ unsafe }),
    _unsafe: unsafe,
  };
}

const TENANT_ID = "tenant-001";
const CONTAINER_ID = "abc-def0-1234-5678-9abc-def012345678";

function makeSchema(columns: Array<{ name: string; type: string; is_filterable: boolean }>): SchemaAnalysisResult {
  return {
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type as any,
      description: `Column ${c.name}`,
      is_filterable: c.is_filterable,
      sample_values: [],
    })),
    rowCount: 100,
    table_description: "Test table",
    analyzed_at: new Date().toISOString(),
  };
}

describe("SKBRowIndexService", () => {
  let service: SKBRowIndexService;
  let sqlProvider: ReturnType<typeof createMockSqlProvider>;

  beforeEach(() => {
    sqlProvider = createMockSqlProvider();
    service = new SKBRowIndexService(sqlProvider as any);
  });

  describe("ensureIndexes", () => {
    it("should create indexes for filterable numeric columns", async () => {
      const schema = makeSchema([
        { name: "price", type: "numeric", is_filterable: true },
        { name: "name", type: "text", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);

      expect(created.length).toBe(1);
      expect(created[0]).toContain("idx_skb_dyn_");
      expect(sqlProvider._unsafe).toHaveBeenCalledTimes(1);

      const callArgs = sqlProvider._unsafe.mock.calls[0];
      expect(callArgs[0]).toContain("CREATE INDEX");
      expect(callArgs[0]).toContain("::numeric");
      expect(callArgs[1]).toEqual([CONTAINER_ID]);
    });

    it("should create indexes for filterable categorical columns", async () => {
      const schema = makeSchema([
        { name: "city", type: "categorical", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);

      expect(created.length).toBe(1);
      const callArgs = sqlProvider._unsafe.mock.calls[0];
      expect(callArgs[0]).toContain("(data->>'city')");
      expect(callArgs[0]).not.toContain("::numeric");
    });

    it("should create indexes for filterable date columns", async () => {
      const schema = makeSchema([
        { name: "created_date", type: "date", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);
      expect(created.length).toBe(1);
    });

    it("should skip non-filterable columns", async () => {
      const schema = makeSchema([
        { name: "price", type: "numeric", is_filterable: false },
        { name: "notes", type: "text", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);
      expect(created.length).toBe(0);
      expect(sqlProvider._unsafe).not.toHaveBeenCalled();
    });

    it("should skip text and boolean types even if filterable", async () => {
      const schema = makeSchema([
        { name: "description", type: "text", is_filterable: true },
        { name: "active", type: "boolean", is_filterable: true },
        { name: "unknown_col", type: "unknown", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);
      expect(created.length).toBe(0);
    });

    it("should create multiple indexes for multiple qualifying columns", async () => {
      const schema = makeSchema([
        { name: "price", type: "numeric", is_filterable: true },
        { name: "quantity", type: "numeric", is_filterable: true },
        { name: "region", type: "categorical", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);
      expect(created.length).toBe(3);
    });

    it("should include WHERE container_id in partial index", async () => {
      const schema = makeSchema([
        { name: "amount", type: "numeric", is_filterable: true },
      ]);

      await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schema);

      const callArgs = sqlProvider._unsafe.mock.calls[0];
      expect(callArgs[0]).toContain("WHERE container_id = $1");
    });

    it("should truncate index name to 63 characters", async () => {
      const longContainerId = "a".repeat(60) + "-bbbb-cccc";
      const schema = makeSchema([
        { name: "very_long_column_name_that_exceeds_normal_length", type: "numeric", is_filterable: true },
      ]);

      const created = await service.ensureIndexes(TENANT_ID, longContainerId, schema);
      expect(created[0].length).toBeLessThanOrEqual(63);
    });

    it("should skip columns with empty sanitized names", async () => {
      const schema = makeSchema([
        { name: "'; DROP TABLE--", type: "numeric", is_filterable: true },
      ]);

      const schemaWithBadName: SchemaAnalysisResult = {
        ...schema,
        columns: schema.columns.map((c) => ({
          ...c,
          name: "'; DROP TABLE--",
        })),
      };

      const created = await service.ensureIndexes(TENANT_ID, CONTAINER_ID, schemaWithBadName);
      expect(created.length).toBe(0);
    });
  });

  describe("dropIndexes", () => {
    it("should drop all dynamic indexes for a container", async () => {
      const prefix = CONTAINER_ID.replace(/-/g, "_");
      sqlProvider._unsafe.mockResolvedValueOnce([
        { indexname: `idx_skb_dyn_${prefix}_price` },
        { indexname: `idx_skb_dyn_${prefix}_quantity` },
      ]);

      const dropped = await service.dropIndexes(TENANT_ID, CONTAINER_ID);

      expect(dropped).toBe(2);
      expect(sqlProvider._unsafe).toHaveBeenCalledTimes(3);
      expect(sqlProvider._unsafe.mock.calls[0][0]).toContain("pg_indexes");
      expect(sqlProvider._unsafe.mock.calls[1][0]).toContain("DROP INDEX");
      expect(sqlProvider._unsafe.mock.calls[2][0]).toContain("DROP INDEX");
    });

    it("should return 0 when no dynamic indexes exist", async () => {
      sqlProvider._unsafe.mockResolvedValueOnce([]);

      const dropped = await service.dropIndexes(TENANT_ID, CONTAINER_ID);
      expect(dropped).toBe(0);
    });

    it("should query with correct prefix pattern", async () => {
      sqlProvider._unsafe.mockResolvedValueOnce([]);

      await service.dropIndexes(TENANT_ID, CONTAINER_ID);

      const callArgs = sqlProvider._unsafe.mock.calls[0];
      expect(callArgs[0]).toContain("pg_indexes");
      expect(callArgs[1]).toEqual([`idx_skb_dyn_${CONTAINER_ID.replace(/-/g, "_")}%`]);
    });
  });
});
