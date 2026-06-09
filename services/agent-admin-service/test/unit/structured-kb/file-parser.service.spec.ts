import "../../setup-env";
import { describe, it, expect, beforeEach, vi } from "bun:test";
import { SKBFileParser } from "../../src/modules/structured-kb/skb-file-parser";
import type { ParsedTable } from "../../src/modules/structured-kb/types/skb.types";

describe("SKBFileParser", () => {
  let parser: SKBFileParser;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const SIMPLE_CSV = "name,age,city\nAlice,30,NYC\nBob,25,LA";
  const EMPTY_HEADERS_ONLY = "name,age,city";
  const SINGLE_ROW = "name,age,city\nAlice,30,NYC";
  const BOM_CSV = "\ufeffname,age,city\nAlice,30,NYC\nBob,25,LA";
  const TAB_CSV = "name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA";
  const WINDOWS_CSV = "name,age,city\r\nAlice,30,NYC\r\nBob,25,LA";
  const SPACES_IN_HEADERS = "First Name,Last Name,Age\nAlice,Smith,30";
  const EUROPEAN_NUMBERS =
    "product,price\nLaptop,1.250,00\nMouse,6,90";
  const SPANISH_BOOLEANS = "name,active\nAlice,verdadero\nBob,falso";

  beforeEach(() => {
    parser = new SKBFileParser();
  });

  // ---------------------------------------------------------------------------
  // parseCsv
  // ---------------------------------------------------------------------------
  describe("parseCsv", () => {
    it("should parse a simple CSV into headers and rows", async () => {
      const result = await parser.parseCsv(
        Buffer.from(SIMPLE_CSV),
        "test.csv",
      );

      expect(result.headers).toEqual(["name", "age", "city"]);
      expect(result.originalHeaders).toEqual(["name", "age", "city"]);
      expect(result.rowCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual({
        name: "Alice",
        age: "30",
        city: "NYC",
      });
      expect(result.rows[1]).toEqual({ name: "Bob", age: "25", city: "LA" });
    });

    it("should detect UTF-8 encoding", async () => {
      const result = await parser.parseCsv(
        Buffer.from(SIMPLE_CSV),
        "test.csv",
      );

      expect(result.detectedEncoding).toBe("utf-8");
    });

    it("should handle UTF-8 BOM prefix", async () => {
      const result = await parser.parseCsv(Buffer.from(BOM_CSV), "test.csv");

      expect(result.headers).toEqual(["name", "age", "city"]);
      expect(result.originalHeaders).toEqual(["\ufeffname", "age", "city"]);
      expect(result.rows[0].name).toBe("Alice");
    });

    it("should handle tab-separated values", async () => {
      const result = await parser.parseCsv(Buffer.from(TAB_CSV), "test.tsv");

      expect(result.headers).toEqual(["name", "age", "city"]);
      expect(result.rowCount).toBe(2);
      expect(result.rows[0].name).toBe("Alice");
    });

    it("should handle Windows CRLF line endings", async () => {
      const result = await parser.parseCsv(
        Buffer.from(WINDOWS_CSV),
        "test.csv",
      );

      expect(result.headers).toEqual(["name", "age", "city"]);
      expect(result.rowCount).toBe(2);
      expect(result.rows[1].city).toBe("LA");
    });

    it("should handle a single data row", async () => {
      const result = await parser.parseCsv(
        Buffer.from(SINGLE_ROW),
        "test.csv",
      );

      expect(result.rowCount).toBe(1);
      expect(result.rows[0].name).toBe("Alice");
    });

    it("should throw for empty file (no data rows)", async () => {
      expect(
        parser.parseCsv(Buffer.from(EMPTY_HEADERS_ONLY), "test.csv"),
      ).rejects.toThrow();
    });

    it("should throw for completely empty buffer", async () => {
      expect(
        parser.parseCsv(Buffer.from(""), "empty.csv"),
      ).rejects.toThrow();
    });

    it("should normalize headers with spaces to snake_case", async () => {
      const result = await parser.parseCsv(
        Buffer.from(SPACES_IN_HEADERS),
        "test.csv",
      );

      expect(result.headers).toEqual(["first_name", "last_name", "age"]);
      expect(result.originalHeaders).toEqual([
        "First Name",
        "Last Name",
        "Age",
      ]);
      expect(result.rows[0].first_name).toBe("Alice");
    });

    it("should pass through European number format values as strings", async () => {
      const result = await parser.parseCsv(
        Buffer.from(EUROPEAN_NUMBERS),
        "test.csv",
      );

      expect(result.rowCount).toBe(2);
      expect(result.headers).toContain("price");
    });

    it("should pass through Spanish boolean values as strings", async () => {
      const result = await parser.parseCsv(
        Buffer.from(SPANISH_BOOLEANS),
        "test.csv",
      );

      expect(result.rowCount).toBe(2);
      expect(result.rows[0].active).toBe("verdadero");
      expect(result.rows[1].active).toBe("falso");
    });

    it("should strip whitespace from cell values", async () => {
      const csv = "name,value\n Alice , 30 \n Bob ,  25";
      const result = await parser.parseCsv(Buffer.from(csv), "test.csv");

      expect(result.rows[0].name).toBe("Alice");
      expect(result.rows[0].value).toBe("30");
      expect(result.rows[1].name).toBe("Bob");
    });

    it("should reject files exceeding max columns", async () => {
      const headers = Array.from({ length: 101 }, (_, i) => `col${i}`).join(
        ",",
      );
      const csv = `${headers}\n${"x,".repeat(100)}x`;

      expect(
        parser.parseCsv(Buffer.from(csv), "wide.csv"),
      ).rejects.toThrow(/column/i);
    });

    it("should set detectedEncoding from chardet/iconv-lite for non-UTF-8", async () => {
      // Latin-1 encoded CSV: "café" as 0x63 0x61 0x66 0xe9
      const latin1Buffer = Buffer.from([
        0x6e, 0x6f, 0x6d, 0x62, 0x72, 0x65, 0x2c, 0x76, 0x61, 0x6c, 0x6f,
        0x72, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x2c, 0x31, 0x30,
      ]);

      const result = await parser.parseCsv(latin1Buffer, "test.csv");

      expect(result.detectedEncoding).not.toBe("utf-8");
      expect(result.detectedEncoding).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // normalizeColumnName (static)
  // ---------------------------------------------------------------------------
  describe("normalizeColumnName", () => {
    it('should convert "First Name" to "first_name"', () => {
      expect(SKBFileParser.normalizeColumnName("First Name")).toBe(
        "first_name",
      );
    });

    it('should convert "Nombre del Cliente" to "nombre_del_cliente"', () => {
      expect(
        SKBFileParser.normalizeColumnName("Nombre del Cliente"),
      ).toBe("nombre_del_cliente");
    });

    it('should prefix with underscore when name starts with digits', () => {
      expect(SKBFileParser.normalizeColumnName("123Column")).toBe(
        "_123column",
      );
    });

    it("should strip surrounding whitespace", () => {
      expect(SKBFileParser.normalizeColumnName("  spaces  ")).toBe("spaces");
    });

    it("should handle empty string by returning fallback", () => {
      expect(SKBFileParser.normalizeColumnName("")).toBe("column_0");
    });

    it("should handle purely special characters", () => {
      expect(SKBFileParser.normalizeColumnName("!!!@@@")).toBe("column_0");
    });

    it("should collapse multiple underscores", () => {
      expect(
        SKBFileParser.normalizeColumnName("Name__With___Underscores"),
      ).toBe("name_with_underscores");
    });

    it("should handle null gracefully", () => {
      expect(SKBFileParser.normalizeColumnName(null as any)).toBe("column_0");
    });

    it("should handle undefined gracefully", () => {
      expect(SKBFileParser.normalizeColumnName(undefined as any)).toBe(
        "column_0",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // normalizeHeaders (static)
  // ---------------------------------------------------------------------------
  describe("normalizeHeaders", () => {
    it("should deduplicate identical column names", () => {
      expect(
        SKBFileParser.normalizeHeaders(["name", "name", "name"]),
      ).toEqual(["name", "name_1", "name_2"]);
    });

    it("should normalize case and then deduplicate", () => {
      expect(
        SKBFileParser.normalizeHeaders(["Name", "NAME", "name"]),
      ).toEqual(["name", "name_1", "name_2"]);
    });

    it("should preserve unique names without suffix", () => {
      expect(
        SKBFileParser.normalizeHeaders(["id", "name", "email"]),
      ).toEqual(["id", "name", "email"]);
    });

    it("should skip empty header fallback in dedup count", () => {
      // Two empty columns → both become column_1, column_2
      const result = SKBFileParser.normalizeHeaders(["", ""]);
      expect(result[0]).toBe("column_1");
      expect(result[1]).toBe("column_2");
    });
  });

  // ---------------------------------------------------------------------------
  // getSampleRows (static)
  // ---------------------------------------------------------------------------
  describe("getSampleRows", () => {
    it("should return all rows when total <= n", () => {
      const rows = [{ a: "1" }, { a: "2" }, { a: "3" }];
      const result = SKBFileParser.getSampleRows(rows, 5);

      expect(result).toHaveLength(3);
      expect(result).toEqual(rows);
    });

    it("should return first 5, middle 10, and last 5 rows for large datasets", () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ idx: String(i) }));
      const result = SKBFileParser.getSampleRows(rows, 20);

      expect(result).toHaveLength(20);
      // First 5
      expect(result[0].idx).toBe("0");
      expect(result[4].idx).toBe("4");
      // Last 5
      expect(result[15].idx).toBe("95");
      expect(result[19].idx).toBe("99");
      // Middle — centered around index 50
      expect(result[5].idx).toBe("45");
      expect(result[14].idx).toBe("54");
    });

    it("should not include duplicate indices when ranges overlap", () => {
      const rows = Array.from({ length: 15 }, (_, i) => ({ idx: String(i) }));
      const result = SKBFileParser.getSampleRows(rows, 20);

      // 15 <= 20, so all rows returned (no sampling needed)
      expect(result).toHaveLength(15);
    });

    it("should preserve original order in sampled result", () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({ idx: String(i) }));
      const result = SKBFileParser.getSampleRows(rows, 20);

      for (let i = 1; i < result.length; i++) {
        expect(Number(result[i].idx)).toBeGreaterThan(
          Number(result[i - 1].idx),
        );
      }
    });

    it("should handle extremely large datasets without crashing", () => {
      const rows = Array.from({ length: 500_000 }, (_, i) => ({
        idx: String(i),
      }));
      const result = SKBFileParser.getSampleRows(rows, 20);

      expect(result).toHaveLength(20);
      expect(result[0].idx).toBe("0");
      expect(result[19].idx).toBe("499999");
    });

    it("should return empty array when rows is empty", () => {
      const result = SKBFileParser.getSampleRows([], 20);

      expect(result).toEqual([]);
    });

    it("should return all rows when n is larger than array length", () => {
      const rows = Array.from({ length: 7 }, (_, i) => ({ idx: String(i) }));
      const result = SKBFileParser.getSampleRows(rows, 20);

      expect(result).toHaveLength(7);
    });
  });
});
