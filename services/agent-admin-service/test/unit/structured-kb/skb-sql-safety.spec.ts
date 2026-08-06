import "../../setup-env";
import { beforeEach, describe, expect, it } from "bun:test";

const load = async () => {
  const mod = await import("../../src/modules/structured-kb/skb-sql-safety");
  return mod;
};

describe("SQL Safety Module", () => {
  let mod: Awaited<ReturnType<typeof load>>;

  beforeEach(async () => {
    mod = await load();
  });

  describe("validateSelectOnly", () => {
    it("should allow a simple SELECT query", () => {
      expect(() =>
        mod.validateSelectOnly("SELECT * FROM skb_rows")
      ).not.toThrow();
    });

    it("should allow SELECT with JOIN", () => {
      expect(() =>
        mod.validateSelectOnly(
          "SELECT a.* FROM skb_rows a JOIN skb_schemas b ON a.container_id = b.container_id"
        )
      ).not.toThrow();
    });

    it("should allow SELECT with WHERE", () => {
      expect(() =>
        mod.validateSelectOnly(
          "SELECT * FROM skb_rows WHERE container_id = 'abc'"
        )
      ).not.toThrow();
    });

    it("should allow SELECT with ORDER BY", () => {
      expect(() =>
        mod.validateSelectOnly(
          "SELECT * FROM skb_rows ORDER BY created_at DESC"
        )
      ).not.toThrow();
    });

    it("should allow SELECT with GROUP BY", () => {
      expect(() =>
        mod.validateSelectOnly(
          "SELECT container_id, COUNT(*) FROM skb_rows GROUP BY container_id"
        )
      ).not.toThrow();
    });

    it("should allow SELECT with LIMIT", () => {
      expect(() =>
        mod.validateSelectOnly("SELECT * FROM skb_rows LIMIT 10")
      ).not.toThrow();
    });

    it("should reject DELETE statements", () => {
      expect(() => mod.validateSelectOnly("DELETE FROM skb_rows")).toThrow();
    });

    it("should reject INSERT statements", () => {
      expect(() =>
        mod.validateSelectOnly("INSERT INTO skb_rows (data) VALUES ('{}')")
      ).toThrow();
    });

    it("should reject UPDATE statements", () => {
      expect(() =>
        mod.validateSelectOnly("UPDATE skb_rows SET data = '{}' WHERE 1=1")
      ).toThrow();
    });

    it("should reject DROP statements", () => {
      expect(() => mod.validateSelectOnly("DROP TABLE skb_rows")).toThrow();
    });

    it("should reject ALTER statements", () => {
      expect(() =>
        mod.validateSelectOnly("ALTER TABLE skb_rows ADD COLUMN test TEXT")
      ).toThrow();
    });

    it("should reject TRUNCATE statements", () => {
      expect(() => mod.validateSelectOnly("TRUNCATE TABLE skb_rows")).toThrow();
    });

    it("should reject CREATE statements", () => {
      expect(() =>
        mod.validateSelectOnly("CREATE TABLE evil (id INT)")
      ).toThrow();
    });

    it("should reject EXEC statements", () => {
      expect(() =>
        mod.validateSelectOnly("EXEC xp_cmdshell('rm -rf /')")
      ).toThrow();
    });

    it("should reject GRANT statements", () => {
      expect(() =>
        mod.validateSelectOnly("GRANT ALL PRIVILEGES ON skb_rows TO public")
      ).toThrow();
    });

    it("should reject REVOKE statements", () => {
      expect(() =>
        mod.validateSelectOnly("REVOKE ALL PRIVILEGES ON skb_rows FROM admin")
      ).toThrow();
    });

    it("should be case-insensitive when rejecting dangerous keywords", () => {
      expect(() => mod.validateSelectOnly("delete from skb_rows")).toThrow();
      expect(() => mod.validateSelectOnly("Drop Table skb_rows")).toThrow();
      expect(() => mod.validateSelectOnly("UPDATE skb_rows SET x=1")).toThrow();
    });
  });

  describe("clampLimit", () => {
    it("should keep a limit below the cap", () => {
      expect(mod.clampLimit(10, 100)).toBe(10);
    });

    it("should keep a limit exactly at the cap", () => {
      expect(mod.clampLimit(100, 100)).toBe(100);
    });

    it("should cap a limit above the cap", () => {
      expect(mod.clampLimit(5000, 100)).toBe(100);
    });

    it("should fall back to the cap when no limit is supplied", () => {
      expect(mod.clampLimit(undefined)).toBe(mod.DEFAULT_LIMIT);
      expect(mod.clampLimit(null)).toBe(mod.DEFAULT_LIMIT);
      expect(mod.clampLimit(undefined, mod.MAX_LIMIT)).toBe(mod.MAX_LIMIT);
    });

    it("should default maxLimit to DEFAULT_LIMIT", () => {
      expect(mod.clampLimit(500)).toBe(mod.DEFAULT_LIMIT);
      expect(mod.clampLimit(50)).toBe(50);
    });

    it("should never let a caller raise the hard MAX_LIMIT ceiling", () => {
      expect(mod.clampLimit(999999, 999999)).toBe(mod.MAX_LIMIT);
    });

    it("should fall back to the cap for a non-finite limit", () => {
      expect(mod.clampLimit(Number.NaN, mod.MAX_LIMIT)).toBe(mod.MAX_LIMIT);
      expect(mod.clampLimit(Number.POSITIVE_INFINITY, mod.MAX_LIMIT)).toBe(
        mod.MAX_LIMIT
      );
    });

    it("should truncate a fractional limit to an integer", () => {
      expect(mod.clampLimit(10.9, 100)).toBe(10);
    });
  });

  describe("enforceLimit", () => {
    it("should add LIMIT 100 if no LIMIT is present", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows", 100);
      expect(result).toContain("LIMIT 100");
    });

    it("should add custom maxLimit if no LIMIT is present", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows", 50);
      expect(result).toContain("LIMIT 50");
    });

    it("should keep existing LIMIT if it does not exceed max", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows LIMIT 10", 100);
      expect(result).toContain("LIMIT 10");
      expect(result).not.toContain("LIMIT 100");
    });

    it("should cap existing LIMIT if it exceeds max", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows LIMIT 500", 100);
      expect(result).toContain("LIMIT 100");
      expect(result).not.toContain("LIMIT 500");
    });

    it("should cap existing LIMIT with custom maxLimit", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows LIMIT 200", 50);
      expect(result).toContain("LIMIT 50");
    });

    it("should handle LIMIT already equal to maxLimit", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows LIMIT 100", 100);
      expect(result).toContain("LIMIT 100");
    });

    it("should handle lowercase limit keyword", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows limit 500", 100);
      expect(result).toContain("LIMIT 100");
    });

    it("should preserve OFFSET when adding LIMIT", () => {
      const result = mod.enforceLimit("SELECT * FROM skb_rows OFFSET 20", 100);
      expect(result).toContain("LIMIT 100");
      expect(result).toContain("OFFSET 20");
    });
  });

  describe("sanitizeIdentifier", () => {
    it("should keep valid alphanumeric identifiers unchanged", () => {
      expect(mod.sanitizeIdentifier("container_id")).toBe("container_id");
    });

    it("should keep digits in identifiers", () => {
      expect(mod.sanitizeIdentifier("col123")).toBe("col123");
    });

    it("should remove single quotes from identifiers", () => {
      expect(mod.sanitizeIdentifier("col'; DROP TABLE")).toBe("col DROP TABLE");
    });

    it("should remove semicolons from identifiers", () => {
      expect(mod.sanitizeIdentifier("name;")).toBe("name");
    });

    it("should remove double dashes (SQL comments) from identifiers", () => {
      expect(mod.sanitizeIdentifier("col--evil")).toBe("colevil");
    });

    it("should remove backticks from identifiers", () => {
      expect(mod.sanitizeIdentifier("`col`")).toBe("col");
    });

    it("should handle empty string", () => {
      expect(mod.sanitizeIdentifier("")).toBe("");
    });

    it("should remove null bytes", () => {
      expect(mod.sanitizeIdentifier("col\0name")).toBe("colname");
    });
  });

  describe("validateWhereClause", () => {
    it("should allow a simple WHERE condition", () => {
      expect(() =>
        mod.validateWhereClause("(data->>'name') ILIKE '%alice%'")
      ).not.toThrow();
    });

    it("should reject stacked queries with semicolons", () => {
      expect(() =>
        mod.validateWhereClause("1=1; DROP TABLE skb_rows")
      ).toThrow();
    });

    it("should reject UNION-based injection", () => {
      expect(() =>
        mod.validateWhereClause(
          "1=1 UNION ALL SELECT * FROM pg_catalog.pg_authid"
        )
      ).toThrow();
    });

    it("should reject UNION ALL specifically", () => {
      expect(() =>
        mod.validateWhereClause("1=1 UNION ALL SELECT password FROM users")
      ).toThrow();
    });

    it("should reject UNION SELECT injection", () => {
      expect(() => mod.validateWhereClause("1=1 UNION SELECT 1,2,3")).toThrow();
    });
  });

  describe("isSafe", () => {
    it("should return true for a valid simple WHERE clause", () => {
      expect(mod.isSafe("(data->>'city') = 'NYC'")).toBe(true);
    });

    it("should return true for a complex but safe WHERE clause", () => {
      expect(
        mod.isSafe(
          "(data->>'age')::numeric > 25 AND (data->>'active')::boolean IS TRUE"
        )
      ).toBe(true);
    });

    it("should return false for DELETE injection", () => {
      expect(mod.isSafe("DELETE FROM skb_rows")).toBe(false);
    });

    it("should return false for semicolon-stacked query", () => {
      expect(mod.isSafe("1=1; DROP TABLE skb_rows")).toBe(false);
    });

    it("should return false for UNION injection", () => {
      expect(mod.isSafe("1=1 UNION SELECT * FROM users")).toBe(false);
    });

    it("should return false for SQL comment injection (--)", () => {
      expect(mod.isSafe("1=1 -- bypass rest")).toBe(false);
    });

    it("should return false for block comment injection (/* */)", () => {
      expect(mod.isSafe("1=1 /* hidden */ OR 1=1")).toBe(false);
    });

    it("should return false for information_schema access", () => {
      expect(
        mod.isSafe("(SELECT table_name FROM information_schema.tables)")
      ).toBe(false);
    });

    it("should return false for pg_catalog access", () => {
      expect(mod.isSafe("(SELECT usename FROM pg_catalog.pg_user)")).toBe(
        false
      );
    });
  });

  describe("subquery safety", () => {
    it("should reject subqueries with DROP inside", () => {
      expect(() =>
        mod.validateWhereClause(
          "(SELECT 1 FROM skb_rows WHERE 1=1) AND (DROP TABLE skb_rows)"
        )
      ).toThrow();
    });

    it("should reject subqueries trying to access pg_catalog", () => {
      expect(() =>
        mod.validateWhereClause(
          "(SELECT count(*) FROM pg_catalog.pg_class) > 0"
        )
      ).toThrow();
    });
  });

  describe("comment rejection", () => {
    it("should reject line comments (--) that could hide SQL", () => {
      expect(() =>
        mod.validateWhereClause("1=1 -- DROP TABLE skb_rows")
      ).toThrow();
    });

    it("should reject block comments (/* */) that could hide SQL", () => {
      expect(() =>
        mod.validateWhereClause("1=1 /* malicious */ AND 1=1")
      ).toThrow();
    });
  });
});
