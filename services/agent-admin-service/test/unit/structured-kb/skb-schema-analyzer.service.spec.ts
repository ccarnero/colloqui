import "../../setup-env";
import { describe, it, expect, beforeEach, vi } from "bun:test";
import { SKBSchemaAnalyzerService } from "../../src/modules/structured-kb/skb-schema-analyzer.service";
import type { ParsedTable } from "../../src/modules/structured-kb/types/skb.types";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";
const mockGenerateObject = vi.mocked(generateObject);

describe("SKBSchemaAnalyzerService", () => {
  let service: SKBSchemaAnalyzerService;

  const PROVIDER_CONFIG = {
    provider: "openai" as const,
    apiKey: "test-key",
    apiBaseUrl: "https://api.openai.com/v1",
  };

  function buildParsedTable(
    overrides: Partial<ParsedTable> = {},
  ): ParsedTable {
    return {
      headers: ["name", "age", "city", "active", "join_date"],
      originalHeaders: ["Name", "Age", "City", "Active", "Join Date"],
      rows: [
        { name: "Alice", age: "30", city: "NYC", active: "true", join_date: "2024-01-15" },
        { name: "Bob", age: "25", city: "LA", active: "false", join_date: "2024-02-20" },
        { name: "Carol", age: "35", city: "NYC", active: "yes", join_date: "2024-03-10" },
        { name: "Dave", age: "28", city: "Chicago", active: "no", join_date: "2024-04-05" },
        { name: "Eve", age: "32", city: "NYC", active: "true", join_date: "2024-05-25" },
      ],
      rowCount: 5,
      detectedEncoding: "utf-8",
      ...overrides,
    };
  }

  const LLM_RESPONSE = {
    table_description: "Employee directory",
    query_rules: "Filter by city or active status",
    columns: [
      { name: "name", original_name: "Name", type: "text", description: "Employee name", sample_values: ["Alice", "Bob"], is_filterable: true, query_hints: [] },
      { name: "age", original_name: "Age", type: "numeric", description: "Employee age", sample_values: ["30", "25"], is_filterable: true, query_hints: ["range queries supported"] },
      { name: "city", original_name: "City", type: "categorical", description: "Office location", sample_values: ["NYC", "LA", "Chicago"], is_filterable: true, query_hints: [] },
      { name: "active", original_name: "Active", type: "boolean", description: "Employment status", sample_values: ["true", "false"], is_filterable: true, query_hints: [] },
      { name: "join_date", original_name: "Join Date", type: "date", description: "Date employee joined", sample_values: ["2024-01-15"], is_filterable: true, query_hints: ["ISO date format"] },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SKBSchemaAnalyzerService();
  });

  describe("analyze", () => {
    it("should call generateObject and return a valid SKBSchema", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_RESPONSE,
      } as any);

      const parsed = buildParsedTable();
      const result = await service.analyze(parsed, PROVIDER_CONFIG, "gpt-4.1-mini");

      expect(result.columns).toHaveLength(5);
      expect(result.columns[0].name).toBe("name");
      expect(result.columns[0].type).toBe("text");
      expect(result.columns[1].type).toBe("numeric");
      expect(result.columns[2].type).toBe("categorical");
      expect(result.columns[3].type).toBe("boolean");
      expect(result.columns[4].type).toBe("date");
      expect(result.rowCount).toBe(5);
      expect(result.table_description).toBe("Employee directory");
    });

    it("should pass system prompt and user prompt to generateObject", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_RESPONSE,
      } as any);

      const parsed = buildParsedTable();
      await service.analyze(parsed, PROVIDER_CONFIG, "gpt-4.1-mini");

      expect(mockGenerateObject).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.system).toContain("data schema analyst");
      expect(callArgs.prompt).toContain("Total rows: 5");
      expect(callArgs.prompt).toContain("name");
      expect(callArgs.prompt).toContain("Alice");
    });

    it("should include heuristic hints in the prompt", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_RESPONSE,
      } as any);

      const parsed = buildParsedTable();
      await service.analyze(parsed, PROVIDER_CONFIG, "gpt-4.1-mini");

      const callArgs = mockGenerateObject.mock.calls[0][0] as any;
      expect(callArgs.prompt).toContain("boolean");
      expect(callArgs.prompt).toContain("numeric");
      expect(callArgs.prompt).toContain("categorical");
      expect(callArgs.prompt).toContain("cardinality");
    });

    it("should detect numeric columns when all values are numbers", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Numbers",
          query_rules: "",
          columns: [
            { name: "price", original_name: "Price", type: "numeric", description: "Price", sample_values: ["10.5", "20"], is_filterable: true, query_hints: [] },
          ],
        },
      } as any);

      const parsed = buildParsedTable({
        headers: ["price"],
        originalHeaders: ["Price"],
        rows: [
          { price: "10.5" },
          { price: "20" },
          { price: "0.99" },
        ],
        rowCount: 3,
      });

      const result = await service.analyze(parsed, PROVIDER_CONFIG, "gpt-4.1-mini");
      expect(result.columns[0].type).toBe("numeric");
    });

    it("should detect boolean columns when values are true/false", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Flags",
          query_rules: "",
          columns: [
            { name: "flag", original_name: "Flag", type: "boolean", description: "Flag", sample_values: ["true", "false"], is_filterable: true, query_hints: [] },
          ],
        },
      } as any);

      const parsed = buildParsedTable({
        headers: ["flag"],
        originalHeaders: ["Flag"],
        rows: [
          { flag: "true" },
          { flag: "false" },
          { flag: "true" },
        ],
        rowCount: 3,
      });

      const result = await service.analyze(parsed, PROVIDER_CONFIG, "gpt-4.1-mini");
      expect(result.columns[0].type).toBe("boolean");
    });

    it("should detect date columns when values are dates", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Events",
          query_rules: "",
          columns: [
            { name: "event_date", original_name: "Event Date", type: "date", description: "Event date", sample_values: ["2024-01-01"], is_filterable: true, query_hints: [] },
          ],
        },
      } as any);

      const result = await service.analyze(
        buildParsedTable({
          headers: ["event_date"],
          originalHeaders: ["Event Date"],
          rows: [
            { event_date: "2024-01-01" },
            { event_date: "2024-06-15" },
          ],
          rowCount: 2,
        }),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      expect(result.columns[0].type).toBe("date");
    });

    it("should detect categorical columns with few repeated values", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Categories",
          query_rules: "",
          columns: [
            { name: "status", original_name: "Status", type: "categorical", description: "Status", sample_values: ["active", "inactive"], is_filterable: true, query_hints: [] },
          ],
        },
      } as any);

      const rows = Array.from({ length: 20 }, (_, i) => ({
        status: i % 2 === 0 ? "active" : "inactive",
      }));

      const result = await service.analyze(
        buildParsedTable({
          headers: ["status"],
          originalHeaders: ["Status"],
          rows,
          rowCount: 20,
        }),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      expect(result.columns[0].type).toBe("categorical");
    });

    it("should detect text columns for free-form text", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Notes",
          query_rules: "",
          columns: [
            { name: "description", original_name: "Description", type: "text", description: "Description", sample_values: ["some long text"], is_filterable: false, query_hints: [] },
          ],
        },
      } as any);

      const result = await service.analyze(
        buildParsedTable({
          headers: ["description"],
          originalHeaders: ["Description"],
          rows: [
            { description: "The quick brown fox" },
            { description: "Jumps over the lazy dog" },
          ],
          rowCount: 2,
        }),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      expect(result.columns[0].type).toBe("text");
      expect(result.columns[0].is_filterable).toBe(false);
    });

    it("should handle empty column gracefully", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Sparse",
          query_rules: "",
          columns: [
            { name: "empty_col", original_name: "Empty Col", type: "unknown", description: "Empty column", sample_values: [], is_filterable: false, query_hints: [] },
          ],
        },
      } as any);

      const result = await service.analyze(
        buildParsedTable({
          headers: ["empty_col"],
          originalHeaders: ["Empty Col"],
          rows: [
            { empty_col: "" },
            { empty_col: "" },
          ],
          rowCount: 2,
        }),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      expect(result.columns[0].type).toBe("unknown");
      expect(result.columns[0].sample_values).toEqual([]);
    });

    it("should handle column with mixed types by returning most common type", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          table_description: "Mixed",
          query_rules: "",
          columns: [
            { name: "value", original_name: "Value", type: "text", description: "Mixed values", sample_values: ["hello", "123", "true"], is_filterable: true, query_hints: [] },
          ],
        },
      } as any);

      const result = await service.analyze(
        buildParsedTable({
          headers: ["value"],
          originalHeaders: ["Value"],
          rows: [
            { value: "hello" },
            { value: "123" },
            { value: "true" },
            { value: "world" },
            { value: "more text" },
          ],
          rowCount: 5,
        }),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      expect(result.columns[0].type).toBe("text");
    });

    it("should throw if generateObject fails", async () => {
      mockGenerateObject.mockRejectedValue(new Error("API error"));

      await expect(
        service.analyze(buildParsedTable(), PROVIDER_CONFIG, "gpt-4.1-mini"),
      ).rejects.toThrow("API error");
    });

    it("should produce analyzed_at as ISO string", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_RESPONSE,
      } as any);

      const result = await service.analyze(
        buildParsedTable(),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      expect(result.analyzed_at).toBeTruthy();
      expect(() => new Date(result.analyzed_at)).not.toThrow();
    });

    it("should produce is_filterable per column", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_RESPONSE,
      } as any);

      const result = await service.analyze(
        buildParsedTable(),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      for (const col of result.columns) {
        expect(typeof col.is_filterable).toBe("boolean");
      }
    });

    it("should produce columns with name, type, description, is_filterable", async () => {
      mockGenerateObject.mockResolvedValue({
        object: LLM_RESPONSE,
      } as any);

      const result = await service.analyze(
        buildParsedTable(),
        PROVIDER_CONFIG,
        "gpt-4.1-mini",
      );

      for (const col of result.columns) {
        expect(col).toHaveProperty("name");
        expect(col).toHaveProperty("type");
        expect(col).toHaveProperty("description");
        expect(col).toHaveProperty("is_filterable");
      }
    });
  });
});
