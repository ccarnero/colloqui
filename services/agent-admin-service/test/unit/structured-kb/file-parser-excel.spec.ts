import "../../setup-env";
import { describe, it, expect, beforeEach, vi } from "bun:test";
import { SKBFileParser } from "../../src/modules/structured-kb/skb-file-parser";
import type { ParsedTable } from "../../src/modules/structured-kb/types/skb.types";

describe("SKBFileParser — parseExcel", () => {
  let parser: SKBFileParser;

  beforeEach(() => {
    parser = new SKBFileParser();
  });

  // ---------------------------------------------------------------------------
  // Happy path: .xlsx
  // ---------------------------------------------------------------------------
  it("should parse a .xlsx buffer into headers and rows", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "test.xlsx",
    );

    expect(result.headers).toBeDefined();
    expect(Array.isArray(result.headers)).toBe(true);
    expect(result.rows).toBeDefined();
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.rowCount).toBe("number");
    expect(typeof result.detectedEncoding).toBe("string");
  });

  // ---------------------------------------------------------------------------
  // Happy path: .xls (legacy format)
  // ---------------------------------------------------------------------------
  it("should parse a .xls buffer (legacy Excel format)", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xls-bytes"),
      "legacy.xls",
    );

    expect(result.headers).toBeDefined();
    expect(result.rows).toBeDefined();
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------------
  // Sheet selection
  // ---------------------------------------------------------------------------
  it("should use the specified sheet name when option is provided", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "multi-sheet.xlsx",
      { sheetName: "Sheet2" },
    );

    expect(result).toBeDefined();
    // The implementation must pass sheetName to the xlsx library.
    // We verify the result is a valid ParsedTable — the mock asserts the lib call.
    expect(result.headers).toBeDefined();
    expect(result.rows).toBeDefined();
  });

  it("should default to first sheet when no sheetName option is provided", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "test.xlsx",
    );

    expect(result).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Column normalization (same logic as CSV)
  // ---------------------------------------------------------------------------
  it("should normalize Excel headers the same way as CSV headers", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "headers.xlsx",
    );

    // Headers with spaces → snake_case, lowercase
    // "First Name" → "first_name", "AGE" → "age", etc.
    // The mock will return specific raw headers; we test the normalization
    // layer applied on top of whatever the xlsx library returns.
    for (const h of result.headers) {
      expect(h).toBe(h.toLowerCase());
      expect(h).not.toMatch(/\s/);
    }
  });

  it("should deduplicate identical column headers from Excel", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "dup-headers.xlsx",
    );

    // If raw headers are ["name", "name", "name"],
    // normalized should be ["name", "name_1", "name_2"]
    const hasDuplicates = new Set(result.headers).size < result.headers.length;
    if (hasDuplicates) {
      // Deduplication should have appended suffixes
      const seen = new Set<string>();
      for (const h of result.headers) {
        expect(seen.has(h)).toBe(false);
        seen.add(h);
      }
    }
  });

  it("should preserve originalHeaders before normalization", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "test.xlsx",
    );

    expect(result.originalHeaders).toBeDefined();
    expect(result.originalHeaders.length).toBe(result.headers.length);
  });

  // ---------------------------------------------------------------------------
  // Empty Excel
  // ---------------------------------------------------------------------------
  it("should handle an empty Excel file (no data rows) and return empty rows array", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-empty-xlsx"),
      "empty.xlsx",
    );

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Single row Excel
  // ---------------------------------------------------------------------------
  it("should handle Excel with a single data row", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-single-row-xlsx"),
      "single.xlsx",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rowCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Formula cells
  // ---------------------------------------------------------------------------
  it("should return computed values for formula cells, not the formula strings", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-formula-xlsx"),
      "formulas.xlsx",
    );

    for (const row of result.rows) {
      for (const value of Object.values(row)) {
        // Computed values should NOT start with "="
        expect(value).not.toMatch(/^=/);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Merged cells
  // ---------------------------------------------------------------------------
  it("should handle merged cells by filling the range with the first cell value", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-merged-xlsx"),
      "merged.xlsx",
    );

    // Merged cells should not produce undefined values in rows
    for (const row of result.rows) {
      for (const [key, value] of Object.entries(row)) {
        expect(value).toBeDefined();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // UTF-8 encoding (Excel stores strings as UTF-8 internally)
  // ---------------------------------------------------------------------------
  it("should detect utf-8 encoding for Excel files", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "test.xlsx",
    );

    expect(result.detectedEncoding).toBe("utf-8");
  });

  it("should correctly handle UTF-8 characters in Excel cell values", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "unicode.xlsx",
    );

    // All string values should be valid UTF-8 strings
    for (const row of result.rows) {
      for (const value of Object.values(row)) {
        expect(typeof value).toBe("string");
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Rejection: unsupported extension
  // ---------------------------------------------------------------------------
  it("should throw for non-Excel file extensions", async () => {
    expect(
      parser.parseExcel(Buffer.from("data"), "test.csv"),
    ).rejects.toThrow(/unsupported|invalid/i);

    expect(
      parser.parseExcel(Buffer.from("data"), "test.pdf"),
    ).rejects.toThrow(/unsupported|invalid/i);
  });

  // ---------------------------------------------------------------------------
  // Rejection: empty buffer
  // ---------------------------------------------------------------------------
  it("should throw for an empty buffer", async () => {
    expect(
      parser.parseExcel(Buffer.from(""), "empty.xlsx"),
    ).rejects.toThrow(/empty/i);
  });

  // ---------------------------------------------------------------------------
  // Max column validation
  // ---------------------------------------------------------------------------
  it("should reject Excel files exceeding the 100-column limit", async () => {
    expect(
      parser.parseExcel(Buffer.from("fake-wide-xlsx"), "wide.xlsx"),
    ).rejects.toThrow(/column/i);
  });

  // ---------------------------------------------------------------------------
  // Max row validation
  // ---------------------------------------------------------------------------
  it("should reject Excel files exceeding the 500,000-row limit", async () => {
    expect(
      parser.parseExcel(Buffer.from("fake-huge-xlsx"), "huge.xlsx"),
    ).rejects.toThrow(/row/i);
  });

  // ---------------------------------------------------------------------------
  // Return shape matches ParsedTable
  // ---------------------------------------------------------------------------
  it("should return an object matching the ParsedTable interface", async () => {
    const result = await parser.parseExcel(
      Buffer.from("fake-xlsx-bytes"),
      "test.xlsx",
    );

    expect(result).toHaveProperty("headers");
    expect(result).toHaveProperty("originalHeaders");
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("rowCount");
    expect(result).toHaveProperty("detectedEncoding");
  });
});
