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

// A statement is idempotent if re-applying it is a no-op. Two ways to earn
// that (per the repo's no-migration-framework pattern):
//
//   1. STRUCTURAL guard — the statement carries an explicit existence guard
//      (IF NOT EXISTS / OR REPLACE / ON CONFLICT). DDL uses this.
//
//   2. CONVERGENT-BY-PREDICATE — a data statement with no existence guard but a
//      WHERE clause whose predicate is unsatisfiable after the first apply, so
//      the second apply matches 0 rows. The corrective compliance backfill
//      (`UPDATE ... SET compliance = 'none' WHERE correlation_id IS NULL AND
//      compliance = 'full'`) is the sole such statement: after it runs, no
//      `compliance = 'full'` row with a NULL correlation_id remains, so re-runs
//      are no-ops. We match it narrowly on that exact convergent shape —
//      self-elimination requires BOTH halves: the SET clause moves
//      `compliance` OFF 'full' (to 'none'/'partial') AND the WHERE clause
//      constrains `compliance = 'full'`. Requiring both is what makes the
//      predicate unsatisfiable on the second apply, so the guard is NOT
//      weakened for any FUTURE non-convergent statement (e.g. a bare UPDATE,
//      or one that constrains `compliance = 'full'` in its WHERE but writes an
//      unrelated column in SET, would still fail this test).
const STRUCTURAL_GUARD = /IF NOT EXISTS|OR REPLACE|ON CONFLICT/i;
const CONVERGENT_UPDATE =
  /^UPDATE\b[\s\S]*\bSET\b[\s\S]*compliance\s*=\s*'(?:none|partial)'[\s\S]*\bWHERE\b[\s\S]*compliance\s*=\s*'full'/i;
const IDEMPOTENT_GUARD = {
  test: (statement: string): boolean =>
    STRUCTURAL_GUARD.test(statement) || CONVERGENT_UPDATE.test(statement),
};

describe("tracked-events.sql", () => {
  it("parses into a non-empty set of statements", () => {
    const statements = readStatements();
    expect(statements.length).toBeGreaterThan(0);
  });

  it("every statement is idempotent (structural guard OR convergent-by-predicate)", () => {
    const statements = readStatements();
    for (const statement of statements) {
      // Fails loudly with the offending statement if neither form matches.
      expect({
        statement,
        idempotent: IDEMPOTENT_GUARD.test(statement),
      }).toEqual({ statement, idempotent: true });
    }
  });

  it("accepts ONLY the convergent compliance UPDATE, not a bare unguarded UPDATE", () => {
    // Guards the guard: the convergent-by-predicate allowance must not degrade
    // into "any UPDATE is idempotent". A bare UPDATE with no self-eliminating
    // predicate stays rejected; only the compliance='full' convergent shape passes.
    expect(
      IDEMPOTENT_GUARD.test(
        "UPDATE tracking.tracked_events SET compliance = 'none' WHERE correlation_id IS NULL AND compliance = 'full'"
      )
    ).toBe(true);
    expect(
      IDEMPOTENT_GUARD.test("UPDATE tracking.tracked_events SET x = 1")
    ).toBe(false);
    expect(
      IDEMPOTENT_GUARD.test(
        "UPDATE tracking.tracked_events SET compliance = 'none' WHERE tenant = 'acme'"
      )
    ).toBe(false);
    // Constrains compliance = 'full' in WHERE but SET touches an unrelated
    // column — NOT self-eliminating, so it must stay rejected.
    expect(
      IDEMPOTENT_GUARD.test(
        "UPDATE tracking.tracked_events SET ingested_at = now() WHERE compliance = 'full'"
      )
    ).toBe(false);
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

  it("retrofits the compliance column idempotently via ALTER ... ADD COLUMN IF NOT EXISTS", () => {
    // The table shipped before `compliance` existed, so `CREATE TABLE IF NOT
    // EXISTS` alone will NOT add the column to a live table. An idempotent
    // `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` retrofit (with a DEFAULT that
    // backfills existing rows) is REQUIRED for the NOT NULL column.
    const statements = readStatements();
    const alter = statements.find((s) =>
      /alter table\s+tracking\.tracked_events/i.test(s)
    );
    expect(alter).toBeDefined();
    expect(alter!).toMatch(/add column if not exists\s+compliance/i);
    // Must carry a DEFAULT so pre-existing rows satisfy NOT NULL on backfill.
    expect(alter!).toMatch(/not null/i);
    expect(alter!).toMatch(/default\s+'full'/i);
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
      "compliance",
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
      "compliance",
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
