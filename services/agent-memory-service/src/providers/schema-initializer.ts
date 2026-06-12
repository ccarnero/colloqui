import type { Sql } from "@yoizen/database";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentMemoryServiceConfig, FTS_LANGUAGE_RE } from "../config";

const MEMORY_SCHEMA_DDL_TEMPLATE = readFileSync(
  join(__dirname, "..", "schema", "memory-schema.sql"),
  "utf8",
);

export function buildDdl(ftsLanguage: string): string {
  if (!FTS_LANGUAGE_RE.test(ftsLanguage)) {
    throw new Error(
      `Invalid ftsLanguage value "${ftsLanguage}". Must match /^[a-z_]+$/.`,
    );
  }
  return MEMORY_SCHEMA_DDL_TEMPLATE.replaceAll("__FTS_LANGUAGE__", ftsLanguage);
}

export async function initAgentMemoryTenantSchema(
  _tenantId: string,
  sql: Sql,
  ftsLanguage?: string,
): Promise<void> {
  const lang = ftsLanguage ?? agentMemoryServiceConfig.ftsLanguage;
  const ddl = buildDdl(lang);

  await sql.begin(async (tx) => {
    await tx.unsafe(`SET client_min_messages TO WARNING`);

    // Apply the base schema (CREATE TABLE IF NOT EXISTS + indexes).
    await tx.unsafe(ddl);

    // ── Idempotent migration: status constraint ──────────────────────────────
    // Only re-create the constraint when the existing definition does not yet
    // include 'ARCHIVED' (i.e. still the old PUBLISHED/EXPIRED shape).
    const statusConstraintRows = await tx<{ constraintdef: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS constraintdef
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'memories'
        AND c.conname = 'memories_status_check'
    `;

    const existingConstraintDef = statusConstraintRows[0]?.constraintdef ?? "";
    if (!existingConstraintDef.includes("ARCHIVED")) {
      // Drop the old constraint first so the data UPDATEs below are not
      // rejected by a CHECK that does not yet include 'ARCHIVED'.
      await tx.unsafe(`ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_status_check`);
      await tx.unsafe(`UPDATE memories SET status = 'ACTIVE'   WHERE status = 'PUBLISHED'`);
      await tx.unsafe(`UPDATE memories SET status = 'ARCHIVED' WHERE status = 'EXPIRED'`);
      await tx.unsafe(
        `ALTER TABLE memories ADD CONSTRAINT memories_status_check ` +
        `CHECK (status IN ('PROPOSED', 'ACTIVE', 'REJECTED', 'ARCHIVED'))`,
      );
    }

    // ── Idempotent migration: FTS language ───────────────────────────────────
    // Re-create the generated column only when it references a different language.
    // STORED generated columns cannot be altered in place in PostgreSQL.
    const ftsExprRows = await tx<{ expr: string }[]>`
      SELECT pg_get_expr(d.adbin, d.adrelid) AS expr
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE d.adrelid = 'memories'::regclass
        AND a.attname = 'search_vector'
    `;

    const currentExpr = ftsExprRows[0]?.expr ?? "";
    const expectedRegconfig = `'${lang}'::regconfig`;
    if (!currentExpr || !currentExpr.includes(expectedRegconfig)) {
      await tx.unsafe(`DROP INDEX IF EXISTS idx_memories_search_vector`);
      await tx.unsafe(`ALTER TABLE memories DROP COLUMN IF EXISTS search_vector`);
      await tx.unsafe(
        `ALTER TABLE memories ADD COLUMN search_vector tsvector ` +
        `GENERATED ALWAYS AS (` +
        `setweight(to_tsvector('${lang}', coalesce(title, '')), 'A') || ` +
        `setweight(to_tsvector('${lang}', coalesce(content, '')), 'B')` +
        `) STORED`,
      );
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_memories_search_vector ON memories USING GIN(search_vector)`,
      );
    }

    await tx.unsafe(`RESET client_min_messages`);
  });
}
