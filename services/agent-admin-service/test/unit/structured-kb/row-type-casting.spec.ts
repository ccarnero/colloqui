import "../../setup-env";
import { describe, it, expect } from "bun:test";
import {
  castValue,
  castRow,
  castBatch,
} from "../../src/modules/structured-kb/row-type-casting";
import type { SKBColumnType } from "../../src/modules/structured-kb/types/skb.types";

describe("castValue", () => {
  describe("numeric type", () => {
    it('should parse "1250.00" as 1250', () => {
      expect(castValue("1250.00", "numeric")).toBe(1250);
    });

    it('should parse European format "1.250,00" as 1250', () => {
      expect(castValue("1.250,00", "numeric")).toBe(1250);
    });

    it('should parse European decimal "6,90" as 6.9', () => {
      expect(castValue("6,90", "numeric")).toBe(6.9);
    });

    it('should parse English format with comma "1,250.00" as 1250', () => {
      expect(castValue("1,250.00", "numeric")).toBe(1250);
    });

    it('should return null for empty string', () => {
      expect(castValue("", "numeric")).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(castValue("   ", "numeric")).toBeNull();
    });

    it('should return original string "N/A" when it cannot parse', () => {
      expect(castValue("N/A", "numeric")).toBe("N/A");
    });

    it('should return original string for unparseable text', () => {
      expect(castValue("abc", "numeric")).toBe("abc");
    });

    it("should parse plain integer string", () => {
      expect(castValue("42", "numeric")).toBe(42);
    });

    it("should parse negative number", () => {
      expect(castValue("-100.50", "numeric")).toBe(-100.5);
    });

    it("should parse zero", () => {
      expect(castValue("0", "numeric")).toBe(0);
    });

    it('should parse "0.00" as 0', () => {
      expect(castValue("0.00", "numeric")).toBe(0);
    });
  });

  describe("boolean type", () => {
    it.each(["true", "TRUE", "True"])(
      'should parse "%s" as true',
      (val) => {
        expect(castValue(val, "boolean")).toBe(true);
      },
    );

    it.each(["yes", "YES", "Yes"])(
      'should parse "%s" as true',
      (val) => {
        expect(castValue(val, "boolean")).toBe(true);
      },
    );

    it('should parse "1" as true', () => {
      expect(castValue("1", "boolean")).toBe(true);
    });

    it('should parse "verdadero" as true', () => {
      expect(castValue("verdadero", "boolean")).toBe(true);
    });

    it('should parse "si" as true', () => {
      expect(castValue("si", "boolean")).toBe(true);
    });

    it('should parse "sí" as true', () => {
      expect(castValue("sí", "boolean")).toBe(true);
    });

    it.each(["false", "FALSE", "False"])(
      'should parse "%s" as false',
      (val) => {
        expect(castValue(val, "boolean")).toBe(false);
      },
    );

    it.each(["no", "NO", "No"])(
      'should parse "%s" as false',
      (val) => {
        expect(castValue(val, "boolean")).toBe(false);
      },
    );

    it('should parse "0" as false', () => {
      expect(castValue("0", "boolean")).toBe(false);
    });

    it('should parse "falso" as false', () => {
      expect(castValue("falso", "boolean")).toBe(false);
    });

    it('should return original string "maybe" when ambiguous', () => {
      expect(castValue("maybe", "boolean")).toBe("maybe");
    });

    it('should return null for empty string', () => {
      expect(castValue("", "boolean")).toBeNull();
    });
  });

  describe("text type", () => {
    it("should return value as-is", () => {
      expect(castValue("hello world", "text")).toBe("hello world");
    });

    it("should return null for empty string", () => {
      expect(castValue("", "text")).toBeNull();
    });

    it("should trim whitespace", () => {
      expect(castValue("  hello  ", "text")).toBe("hello");
    });
  });

  describe("categorical type", () => {
    it("should return value as-is (same as text)", () => {
      expect(castValue("Sales", "categorical")).toBe("Sales");
    });

    it("should return null for empty string", () => {
      expect(castValue("", "categorical")).toBeNull();
    });
  });

  describe("date type", () => {
    it("should return ISO date string as-is", () => {
      expect(castValue("2024-01-15", "date")).toBe("2024-01-15");
    });

    it("should return slash-formatted date as-is", () => {
      expect(castValue("01/15/2024", "date")).toBe("01/15/2024");
    });

    it("should return null for empty string", () => {
      expect(castValue("", "date")).toBeNull();
    });
  });

  describe("unknown type", () => {
    it("should return value as-is", () => {
      expect(castValue("anything", "unknown")).toBe("anything");
    });

    it("should return null for empty string", () => {
      expect(castValue("", "unknown")).toBeNull();
    });
  });
});

describe("castRow", () => {
  it("should cast all columns in a row based on column types", () => {
    const row = {
      name: "Alice",
      age: "30",
      active: "true",
      salary: "1.250,00",
    };
    const columnTypes = new Map<string, SKBColumnType>([
      ["name", "text"],
      ["age", "numeric"],
      ["active", "boolean"],
      ["salary", "numeric"],
    ]);

    const result = castRow(row, columnTypes);

    expect(result).toEqual({
      name: "Alice",
      age: 30,
      active: true,
      salary: 1250,
    });
  });

  it("should leave columns not in columnTypes as-is", () => {
    const row = { name: "Alice", unknown_col: "value" };
    const columnTypes = new Map<string, SKBColumnType>([
      ["name", "text"],
    ]);

    const result = castRow(row, columnTypes);

    expect(result.unknown_col).toBe("value");
  });

  it("should handle empty row", () => {
    const result = castRow({}, new Map());

    expect(result).toEqual({});
  });

  it("should handle row with empty values producing nulls", () => {
    const row = { name: "", age: "" };
    const columnTypes = new Map<string, SKBColumnType>([
      ["name", "text"],
      ["age", "numeric"],
    ]);

    const result = castRow(row, columnTypes);

    expect(result).toEqual({ name: null, age: null });
  });
});

describe("castBatch", () => {
  it("should cast multiple rows with the same column types", () => {
    const rows = [
      { name: "Alice", age: "30", active: "true" },
      { name: "Bob", age: "25", active: "false" },
      { name: "Carol", age: "35", active: "yes" },
    ];
    const columnTypes = new Map<string, SKBColumnType>([
      ["name", "text"],
      ["age", "numeric"],
      ["active", "boolean"],
    ]);

    const result = castBatch(rows, columnTypes);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "Alice", age: 30, active: true });
    expect(result[1]).toEqual({ name: "Bob", age: 25, active: false });
    expect(result[2]).toEqual({ name: "Carol", age: 35, active: true });
  });

  it("should handle empty batch", () => {
    const result = castBatch([], new Map());

    expect(result).toEqual([]);
  });

  it("should handle rows with inconsistent keys", () => {
    const rows = [
      { a: "10", b: "hello" },
      { a: "20" },
      { a: "30", b: "world", c: "extra" },
    ];
    const columnTypes = new Map<string, SKBColumnType>([
      ["a", "numeric"],
      ["b", "text"],
    ]);

    const result = castBatch(rows, columnTypes);

    expect(result[0].a).toBe(10);
    expect(result[1].a).toBe(20);
    expect(result[2].a).toBe(30);
    expect(result[2].c).toBe("extra");
  });
});
