import "../../setup-env";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import { Test } from "@nestjs/testing";

const load = async () => {
  const { SKBQueryService } = await import(
    "../../src/modules/structured-kb/skb-query.service"
  );
  return { SKBQueryService };
};

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";

const mockGenerateObject = vi.mocked(generateObject);

// createSkbLanguageModel (real) requires an API key to build the model
// instance; the actual LLM call (generateObject) is mocked above.
process.env.OPENAI_API_KEY ??= "sk-test-not-a-real-key";

describe("SKBQueryService", () => {
  let service: any;
  let schemaRepository: {
    loadAllSchemas: ReturnType<typeof vi.fn>;
  };
  let rowsRepository: {
    executeQuery: ReturnType<typeof vi.fn>;
    countByContainer: ReturnType<typeof vi.fn>;
  };
  let connectionManager: {
    ensureSchema: ReturnType<typeof vi.fn>;
  };

  const TENANT_ID = "tenant-123";
  const CONTAINER_ID = "container-abc";

  const MOCK_SCHEMAS = [
    {
      table_description: "Sales data for Q1 2026",
      columns: [
        {
          name: "product",
          original_name: "Product",
          type: "categorical",
          description: "Product name",
          sample_values: ["Widget A", "Widget B"],
          is_filterable: true,
          query_hints: ["exact match"],
        },
        {
          name: "price",
          original_name: "Price",
          type: "numeric",
          description: "Unit price in USD",
          sample_values: ["29.99", "49.99"],
          is_filterable: true,
          query_hints: ["range queries supported"],
        },
        {
          name: "region",
          original_name: "Region",
          type: "categorical",
          description: "Sales region",
          sample_values: ["North", "South", "East", "West"],
          is_filterable: true,
          query_hints: [],
        },
        {
          name: "sale_date",
          original_name: "Sale Date",
          type: "date",
          description: "Date of sale",
          sample_values: ["2026-01-15"],
          is_filterable: true,
          query_hints: ["ISO date format"],
        },
      ],
      query_rules: "Always filter by region when asked about geography",
      row_count: 1500,
      analyzed_at: "2026-01-15T00:00:00Z",
    },
    {
      table_description: "Returns and refunds log",
      columns: [
        {
          name: "product",
          original_name: "Product",
          type: "categorical",
          description: "Product name",
          sample_values: ["Widget A"],
          is_filterable: true,
          query_hints: [],
        },
        {
          name: "return_reason",
          original_name: "Return Reason",
          type: "text",
          description: "Reason for return",
          sample_values: ["defective", "wrong size"],
          is_filterable: false,
          query_hints: [],
        },
      ],
      query_rules: "",
      row_count: 200,
      analyzed_at: "2026-01-20T00:00:00Z",
    },
  ];

  const LLM_TRANSLATION = {
    where_clause: "(data->>'region') = 'North'",
    order_by: "(data->>'price')::numeric DESC",
    explanation: "Filter by North region, sort by price descending",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await load();

    schemaRepository = {
      loadAllSchemas: vi.fn(() => Promise.resolve(MOCK_SCHEMAS)),
    };

    rowsRepository = {
      executeQuery: vi.fn(() =>
        Promise.resolve({
          results: [
            { product: "Widget A", price: 49.99, region: "North" },
            { product: "Widget B", price: 29.99, region: "North" },
          ],
          totalCount: 42,
        })
      ),
      countByContainer: vi.fn(() => Promise.resolve(42)),
    };

    connectionManager = {
      ensureSchema: vi.fn(() => Promise.resolve({})),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        mod.SKBQueryService,
        { provide: "SKBSchemaRepository", useValue: schemaRepository },
        { provide: "SKBRowsRepository", useValue: rowsRepository },
        { provide: "TenantConnectionManager", useValue: connectionManager },
      ],
    }).compile();

    service = moduleRef.get(mod.SKBQueryService);
  });

  describe("query(tenantId, containerId, nlQuery, options?)", () => {
    it("should return { results, sql, totalCount }", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      const result = await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show me sales in the North region"
      );

      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("sql");
      expect(result).toHaveProperty("totalCount");
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.sql).toBe("string");
      expect(typeof result.totalCount).toBe("number");
    });

    it("should call generateObject with schema context in the prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show me sales in the North region"
      );

      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateObject.mock.calls[0][0] as any;

      expect(callArgs.prompt).toContain("product");
      expect(callArgs.prompt).toContain("price");
      expect(callArgs.prompt).toContain("region");
      expect(callArgs.prompt).toContain("categorical");
      expect(callArgs.prompt).toContain("numeric");
    });

    it("should include column descriptions in the prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show me sales");

      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.prompt).toContain("Unit price in USD");
      expect(callArgs.prompt).toContain("Sales region");
    });

    it("should include query_rules in the prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show me sales");

      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.prompt).toContain(
        "Always filter by region when asked about geography"
      );
    });
  });

  describe("category filtering", () => {
    it("should pass categories to the query prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          where_clause: "(data->>'region') = 'North'",
          order_by: undefined,
          explanation: "",
        },
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show sales", {
        categories: ["sales"],
      });

      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.prompt).toContain("sales");
    });

    it("should pass multiple categories to the query prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: { where_clause: "1=1", order_by: undefined, explanation: "" },
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show data", {
        categories: ["sales", "q1"],
      });

      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.prompt).toContain("sales");
      expect(callArgs.prompt).toContain("q1");
    });
  });

  describe("pagination", () => {
    it("should support limit and offset via options", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      rowsRepository.executeQuery.mockResolvedValue(
        Promise.resolve({
          results: [{ product: "Widget A" }],
          totalCount: 100,
        })
      );

      const result = await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show sales",
        {
          limit: 10,
          offset: 20,
        }
      );

      expect(rowsRepository.executeQuery).toHaveBeenCalled();
      const execCall = rowsRepository.executeQuery.mock.calls[0];
      expect(execCall).toBeDefined();
    });

    it("should apply default limit when no limit is specified", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show sales");

      const execCall = rowsRepository.executeQuery.mock.calls[0];
      expect(execCall).toBeDefined();
      expect(execCall[2].limit).toBe(100);
    });

    it("should pass the requested limit through untouched when below the cap", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      const result = await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show sales",
        {
          limit: 500,
          offset: 20,
        }
      );

      const execCall = rowsRepository.executeQuery.mock.calls[0];
      expect(execCall[2].limit).toBe(500);
      expect(execCall[2].offset).toBe(20);
      expect(result.sql).toContain("LIMIT 500 OFFSET 20");
    });

    it("should clamp a limit above the hard cap for both the executed query and the debug sql", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      const result = await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show sales",
        {
          limit: 999999,
          offset: 0,
        }
      );

      // One clamp, one value: the repository and buildSql must agree, or the
      // `sql` recorded in skb_query_history stops matching what ran.
      const execCall = rowsRepository.executeQuery.mock.calls[0];
      expect(execCall[2].limit).toBe(1000);
      expect(result.sql).toContain("LIMIT 1000 OFFSET 0");
      expect(result.sql).not.toContain("999999");
    });
  });

  describe("empty result set", () => {
    it("should return empty array when no rows match", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          where_clause: "(data->>'region') = 'Antarctica'",
          order_by: undefined,
          explanation: "",
        },
      } as any);

      rowsRepository.executeQuery.mockResolvedValue(
        Promise.resolve({ results: [], totalCount: 0 })
      );

      const result = await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show sales in Antarctica"
      );

      expect(result.results).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe("LLM failure handling", () => {
    it("should throw a descriptive error when generateObject fails", async () => {
      mockGenerateObject.mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(
        service.query(TENANT_ID, CONTAINER_ID, "show sales")
      ).rejects.toThrow();
    });

    it("should throw a descriptive error when generateObject returns invalid SQL", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          where_clause: "DELETE FROM skb_rows WHERE 1=1",
          order_by: undefined,
          explanation: "malicious",
        },
      } as any);

      await expect(
        service.query(TENANT_ID, CONTAINER_ID, "show sales")
      ).rejects.toThrow();
    });
  });

  describe("SQL validation", () => {
    it("should reject generated SQL containing DELETE", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          where_clause: "1=1; DELETE FROM skb_rows",
          order_by: undefined,
          explanation: "malicious",
        },
      } as any);

      await expect(
        service.query(TENANT_ID, CONTAINER_ID, "show all data")
      ).rejects.toThrow();
    });

    it("should reject generated SQL containing DROP", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          where_clause: "1=1; DROP TABLE skb_rows",
          order_by: undefined,
          explanation: "malicious",
        },
      } as any);

      await expect(
        service.query(TENANT_ID, CONTAINER_ID, "show all data")
      ).rejects.toThrow();
    });

    it("should reject generated SQL containing UNION injection", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          where_clause: "1=1 UNION ALL SELECT * FROM pg_catalog.pg_user",
          order_by: undefined,
          explanation: "malicious",
        },
      } as any);

      await expect(
        service.query(TENANT_ID, CONTAINER_ID, "show all data")
      ).rejects.toThrow();
    });
  });

  describe("schema merging", () => {
    it("should load schemas from ALL files in the container", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show sales");

      expect(schemaRepository.loadAllSchemas).toHaveBeenCalledWith(
        TENANT_ID,
        CONTAINER_ID
      );
    });

    it("should merge columns from multiple schemas into the prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      await service.query(TENANT_ID, CONTAINER_ID, "show sales and returns");

      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.prompt).toContain("product");
      expect(callArgs.prompt).toContain("price");
      expect(callArgs.prompt).toContain("return_reason");
    });
  });

  describe("executedSql in response", () => {
    it("should return executedSql in the response for debugging", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_TRANSLATION,
      } as any);

      const result = await service.query(TENANT_ID, CONTAINER_ID, "show sales");

      expect(result).toHaveProperty("sql");
      expect(result.sql).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Query history recording (DOC-VS-CODE-AUDIT.md SKB defect 4) —
  // `skb_query_history` was registered but never written to. `query()`
  // now fire-and-forgets a `recordQuery` call on both success and failure,
  // and a history-write failure must only log a warning: the query result
  // (or the original query error) must still propagate untouched.
  // ──────────────────────────────────────────────────────────────────────

  describe("query history recording (SKB defect 4)", () => {
    let queryHistoryService: { recordQuery: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      vi.clearAllMocks();

      const mod = await load();

      schemaRepository = {
        loadAllSchemas: vi.fn(() => Promise.resolve(MOCK_SCHEMAS)),
      };
      rowsRepository = {
        executeQuery: vi.fn(() =>
          Promise.resolve({
            results: [{ product: "Widget A" }],
            totalCount: 1,
          })
        ),
        countByContainer: vi.fn(() => Promise.resolve(1)),
      };
      connectionManager = {
        ensureSchema: vi.fn(() => Promise.resolve({})),
      };
      queryHistoryService = {
        recordQuery: vi.fn(() => Promise.resolve({})),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          mod.SKBQueryService,
          { provide: "SKBSchemaRepository", useValue: schemaRepository },
          { provide: "SKBRowsRepository", useValue: rowsRepository },
          { provide: "TenantConnectionManager", useValue: connectionManager },
          {
            provide: "SKBQueryHistoryService",
            useValue: queryHistoryService,
          },
        ],
      }).compile();

      service = moduleRef.get(mod.SKBQueryService);
    });

    it("records history on a successful query with the resolved SQL, result count, and no error", async () => {
      mockGenerateObject.mockResolvedValue({ object: LLM_TRANSLATION } as any);

      const result = await service.query(
        TENANT_ID,
        CONTAINER_ID,
        "show sales in the North region"
      );

      // Fire-and-forget: give the microtask queue a tick to flush the call.
      await Promise.resolve();

      expect(queryHistoryService.recordQuery).toHaveBeenCalledTimes(1);
      const [
        tenantId,
        containerId,
        nlQuery,
        generatedSql,
        resultCount,
        durationMs,
        error,
      ] = queryHistoryService.recordQuery.mock.calls[0];
      expect(tenantId).toBe(TENANT_ID);
      expect(containerId).toBe(CONTAINER_ID);
      expect(nlQuery).toBe("show sales in the North region");
      expect(generatedSql).toBe(result.sql);
      expect(resultCount).toBe(1);
      expect(typeof durationMs).toBe("number");
      expect(error).toBeNull();
    });

    it("records history on a failed query with the error message and resultCount=0", async () => {
      mockGenerateObject.mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(
        service.query(TENANT_ID, CONTAINER_ID, "show sales")
      ).rejects.toThrow("Rate limit exceeded");

      await Promise.resolve();

      expect(queryHistoryService.recordQuery).toHaveBeenCalledTimes(1);
      const [, , , generatedSql, resultCount, , error] =
        queryHistoryService.recordQuery.mock.calls[0];
      expect(generatedSql).toBe("");
      expect(resultCount).toBe(0);
      expect(error).toContain("Rate limit exceeded");
    });

    it("still returns the query result when the history write itself fails (fire-and-forget)", async () => {
      mockGenerateObject.mockResolvedValue({ object: LLM_TRANSLATION } as any);
      queryHistoryService.recordQuery.mockRejectedValue(
        new Error("history db unreachable")
      );

      const result = await service.query(TENANT_ID, CONTAINER_ID, "show sales");

      expect(result.results).toEqual([{ product: "Widget A" }]);
      expect(result.totalCount).toBe(1);

      // Let the rejected fire-and-forget promise's .catch() run.
      await Promise.resolve();
      await Promise.resolve();
    });

    it("does not throw when queryHistoryService is not provided (optional dependency)", async () => {
      const mod = await load();
      const moduleRef = await Test.createTestingModule({
        providers: [
          mod.SKBQueryService,
          { provide: "SKBSchemaRepository", useValue: schemaRepository },
          { provide: "SKBRowsRepository", useValue: rowsRepository },
          { provide: "TenantConnectionManager", useValue: connectionManager },
        ],
      }).compile();
      const serviceWithoutHistory = moduleRef.get(mod.SKBQueryService);

      mockGenerateObject.mockResolvedValue({ object: LLM_TRANSLATION } as any);

      await expect(
        serviceWithoutHistory.query(TENANT_ID, CONTAINER_ID, "show sales")
      ).resolves.toHaveProperty("results");
    });
  });
});
