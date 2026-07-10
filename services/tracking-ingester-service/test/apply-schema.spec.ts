import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applySchema } from "../src/lib/apply-schema.js";
import { loadSchemaStatements } from "../src/lib/load-schema-statements.js";

const SQL_PATH = join(
  import.meta.dir,
  "..",
  "src",
  "sql",
  "tracked-events.sql"
);

function readStatements(): string[] {
  return loadSchemaStatements(readFileSync(SQL_PATH, "utf8"));
}

// A statement is idempotent if re-applying it is a no-op. For raw DDL that
// means it must carry one of these guards (per the repo's no-migration-
// framework pattern): IF NOT EXISTS, OR REPLACE, or ON CONFLICT.
const IDEMPOTENT_GUARD = /IF NOT EXISTS|OR REPLACE|ON CONFLICT/i;

describe("tracked-events.sql", () => {
  it("parses into a non-empty set of statements", () => {
    const statements = readStatements();
    expect(statements.length).toBeGreaterThan(0);
  });

  it("every statement is idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT)", () => {
    const statements = readStatements();
    for (const statement of statements) {
      expect(statement).toMatch(IDEMPOTENT_GUARD);
    }
  });

  it("creates the tracking schema and tracked_events table with the PK", () => {
    const statements = readStatements();
    const joined = statements.join("\n").toLowerCase();
    expect(joined).toContain("create schema if not exists tracking");
    expect(joined).toContain(
      "create table if not exists tracking.tracked_events"
    );
    expect(joined).toContain("event_id");
    expect(joined).toContain("primary key");
  });

  it("indexes correlation_id, occurred_at and business_fn", () => {
    const statements = readStatements();
    const indexed = statements
      .filter((s) => /create index/i.test(s))
      .join("\n")
      .toLowerCase();
    expect(indexed).toContain("(correlation_id)");
    expect(indexed).toContain("(occurred_at)");
    expect(indexed).toContain("(business_fn)");
  });

  it("carries every TrackedEventRow column in the table DDL", () => {
    const statements = readStatements();
    const tableStatement = statements
      .find((s) => /create table/i.test(s))!
      .toLowerCase();
    const columns = [
      "event_id",
      "subject",
      "tenant",
      "producer",
      "domain",
      "kind",
      "version",
      "correlation_id",
      "causation_id",
      "causation_depth",
      "occurred_at",
      "tech",
      "business_fn",
      "rule",
      "consumed_by",
      "is_claim_check",
      "envelope",
      "ingested_at",
    ];
    for (const column of columns) {
      expect(tableStatement).toContain(column);
    }
  });

  it("binds nullability to the TrackedEventRow contract per column", () => {
    const statements = readStatements();
    const tableStatement = statements.find((s) => /create table/i.test(s))!;
    // Extract each column line so we can assert NOT NULL presence/absence
    // without the PRIMARY KEY / DEFAULT clauses bleeding across columns.
    const columnLine = (name: string): string => {
      const line = tableStatement
        .split("\n")
        .map((l) => l.trim())
        .find((l) => new RegExp(`^${name}\\b`, "i").test(l));
      if (!line) {
        throw new Error(`column ${name} not found in table DDL`);
      }
      return line;
    };

    // Nullable — non-envelope rows carry no such value (see SQL header).
    const nullable = [
      "tenant",
      "kind",
      "version",
      "correlation_id",
      "causation_id",
      "causation_depth",
    ];
    for (const column of nullable) {
      expect(columnLine(column)).not.toMatch(/NOT NULL/i);
    }

    // Non-nullable — every remaining mapped column. event_id is PRIMARY KEY
    // (implicitly NOT NULL); the rest declare NOT NULL explicitly.
    expect(columnLine("event_id")).toMatch(/PRIMARY KEY/i);
    const notNull = [
      "subject",
      "producer",
      "domain",
      "occurred_at",
      "tech",
      "business_fn",
      "rule",
      "consumed_by",
      "is_claim_check",
      "envelope",
      "ingested_at",
    ];
    for (const column of notNull) {
      expect(columnLine(column)).toMatch(/NOT NULL/i);
    }
  });
});

describe("applySchema", () => {
  it("runs every statement in order via client.unsafe and reports the count", async () => {
    const statements = readStatements();
    const seen: string[] = [];
    const client = {
      unsafe: async (query: string): Promise<unknown> => {
        seen.push(query);
        return undefined;
      },
    };

    const result = await applySchema(client, statements);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.applied).toBe(statements.length);
    }
    expect(seen).toEqual([...statements]);
  });

  it("returns a structured err at the first failing statement", async () => {
    const client = {
      unsafe: async (query: string): Promise<unknown> => {
        if (query.includes("BOOM")) {
          throw new Error("syntax error near BOOM");
        }
        return undefined;
      },
    };

    const result = await applySchema(client, [
      "CREATE SCHEMA IF NOT EXISTS tracking",
      "BOOM",
      "CREATE INDEX IF NOT EXISTS never_reached ON x (y)",
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.index).toBe(1);
      expect(result.error.statement).toBe("BOOM");
      expect(result.error.reason).toContain("syntax error");
    }
  });
});
