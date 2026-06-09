import "../../setup-env";
import { describe, it, expect, beforeEach } from "bun:test";
import { SKBFileParser } from "../../src/modules/structured-kb/skb-file-parser";

describe("SKBFileParser — parseCsvStream", () => {
  let parser: SKBFileParser;

  beforeEach(() => {
    parser = new SKBFileParser();
  });

  function makeCsv(rowCount: number, columns: string[] = ["name", "age", "city"]): Buffer {
    const header = columns.join(",");
    const rows: string[] = [header];
    for (let i = 0; i < rowCount; i++) {
      rows.push(
        columns.map((_, ci) => `val_${i}_${ci}`).join(","),
      );
    }
    return Buffer.from(rows.join("\n"));
  }

  it("should produce the same output as parseCsv for small files", async () => {
    const csv = "name,age,city\nAlice,30,NYC\nBob,25,LA";
    const buf = Buffer.from(csv);

    const streamResult = await parser.parseCsvStream(buf, "test.csv");
    const normalResult = await parser.parseCsv(buf, "test.csv");

    expect(streamResult.headers).toEqual(normalResult.headers);
    expect(streamResult.originalHeaders).toEqual(normalResult.originalHeaders);
    expect(streamResult.rowCount).toBe(normalResult.rowCount);
    expect(streamResult.rows).toEqual(normalResult.rows);
    expect(streamResult.detectedEncoding).toBe(normalResult.detectedEncoding);
  });

  it("should report correct row count for large files", async () => {
    const rowCount = 10_000;
    const buf = makeCsv(rowCount);

    const result = await parser.parseCsvStream(buf, "large.csv");

    expect(result.rowCount).toBe(rowCount);
    expect(result.rows).toHaveLength(rowCount);
  });

  it("should handle chunk boundaries correctly (no split rows)", async () => {
    const rowCount = 5_000;
    const buf = makeCsv(rowCount, ["a", "b", "c"]);

    const result = await parser.parseCsvStream(buf, "chunked.csv");

    for (const row of result.rows) {
      expect(Object.keys(row).length).toBe(3);
      expect(row.a).toBeDefined();
      expect(row.b).toBeDefined();
      expect(row.c).toBeDefined();
    }
  });

  it("should normalize headers the same as parseCsv", async () => {
    const csv = "First Name,Last Name,Age\nAlice,Smith,30";
    const buf = Buffer.from(csv);

    const streamResult = await parser.parseCsvStream(buf, "headers.csv");
    const normalResult = await parser.parseCsv(buf, "headers.csv");

    expect(streamResult.headers).toEqual(["first_name", "last_name", "age"]);
    expect(streamResult.headers).toEqual(normalResult.headers);
  });

  it("should handle UTF-8 BOM correctly", async () => {
    const csv = "\ufeffname,age,city\nAlice,30,NYC";
    const buf = Buffer.from(csv);

    const result = await parser.parseCsvStream(buf, "bom.csv");

    expect(result.headers).toEqual(["name", "age", "city"]);
    expect(result.rowCount).toBe(1);
  });

  it("should throw for empty buffer", async () => {
    await expect(
      parser.parseCsvStream(Buffer.from(""), "empty.csv"),
    ).rejects.toThrow(/empty/i);
  });

  it("should throw for headers-only (no data rows)", async () => {
    await expect(
      parser.parseCsvStream(Buffer.from("name,age,city"), "no-data.csv"),
    ).rejects.toThrow();
  });

  it("should reject files exceeding max columns", async () => {
    const headers = Array.from({ length: 101 }, (_, i) => `col${i}`).join(",");
    const csv = `${headers}\n${Array.from({ length: 101 }, (_, i) => `v${i}`).join(",")}`;

    await expect(
      parser.parseCsvStream(Buffer.from(csv), "wide.csv"),
    ).rejects.toThrow(/column/i);
  });

  it("should strip whitespace from cell values", async () => {
    const csv = "name,value\n Alice , 30 \n Bob ,  25";
    const result = await parser.parseCsvStream(Buffer.from(csv), "ws.csv");

    expect(result.rows[0].name).toBe("Alice");
    expect(result.rows[0].value).toBe("30");
    expect(result.rows[1].name).toBe("Bob");
    expect(result.rows[1].value).toBe("25");
  });
});
