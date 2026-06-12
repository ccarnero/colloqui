import "../setup-env";
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDdl } from "../../src/providers/schema-initializer";

// Read the DDL template directly to inspect it independently of the module.
const TEMPLATE_PATH = join(
  __dirname,
  "../../src/schema/memory-schema.sql",
);

describe("schema-initializer placeholder substitution", () => {
  const template = readFileSync(TEMPLATE_PATH, "utf8");

  it("template must not contain the literal string 'spanish'", () => {
    expect(template).not.toContain("'spanish'");
  });

  it("template contains the __FTS_LANGUAGE__ placeholder at least twice", () => {
    const occurrences = (template.match(/__FTS_LANGUAGE__/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("substitutes placeholder with the configured language", () => {
    const ddl = buildDdl("english");
    expect(ddl).toContain("'english'");
    expect(ddl).not.toContain("__FTS_LANGUAGE__");
  });

  it("substitutes all occurrences", () => {
    const ddl = buildDdl("french");
    const remaining = (ddl.match(/__FTS_LANGUAGE__/g) ?? []).length;
    expect(remaining).toBe(0);
  });

  it("throws when lang contains invalid characters", () => {
    expect(() => buildDdl("'; DROP TABLE--")).toThrow(
      /Invalid ftsLanguage/,
    );
  });

  it("throws when lang is empty", () => {
    expect(() => buildDdl("")).toThrow(/Invalid ftsLanguage/);
  });

  it("status constraint in DDL includes ARCHIVED and not PUBLISHED/EXPIRED", () => {
    const ddl = buildDdl("spanish");
    expect(ddl).toContain("'ARCHIVED'");
    expect(ddl).not.toContain("'PUBLISHED'");
    expect(ddl).not.toContain("'EXPIRED'");
  });

  it("status constraint in DDL is named memories_status_check", () => {
    const ddl = buildDdl("spanish");
    expect(ddl).toContain("CONSTRAINT memories_status_check");
  });
});
