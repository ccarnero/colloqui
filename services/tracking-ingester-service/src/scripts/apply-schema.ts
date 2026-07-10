#!/usr/bin/env bun
/**
 * apply-schema.ts — runnable entry that applies the tracking store DDL
 * (src/sql/tracked-events.sql) to the dev Postgres.
 *
 * Idempotent by construction (every statement is CREATE ... IF NOT EXISTS), so
 * running it twice is safe and BOTH runs exit 0.
 *
 * Usage:
 *   POSTGRES_URL=postgres://... bun run src/scripts/apply-schema.ts
 *
 * Connection:
 *   Reads POSTGRES_URL (preferred) or DATABASE_URL. Neither is defaulted — if
 *   both are unset the script logs the missing names and exits 1.
 *
 *   To reach the dev cluster Postgres, port-forward first (OrbStack, namespace
 *   support-services-dev):
 *
 *     kubectl port-forward -n support-services-dev svc/postgres 5432:5432
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { applySchema } from "../lib/apply-schema.js";
import { loadSchemaStatements } from "../lib/load-schema-statements.js";

const DSN_ENV: readonly string[] = ["POSTGRES_URL", "DATABASE_URL"];

function log(message: string): void {
  console.log(`[apply-schema] ${message}`);
}

/** Mirrors scripts/reset-dev.ts: connection is never defaulted. */
function resolveDsn(): string | undefined {
  for (const name of DSN_ENV) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const dsn = resolveDsn();
  if (!dsn) {
    log(`Missing required env — set one of: ${DSN_ENV.join(", ")}`);
    log(
      "Hint: kubectl port-forward -n support-services-dev svc/postgres 5432:5432"
    );
    process.exit(1);
  }

  // Never print credentials — only host/db so the operator can confirm target.
  const redacted = dsn.replace(/\/\/[^@]*@/, "//***@");
  log(`Connecting to ${redacted}`);

  const sqlPath = fileURLToPath(
    new URL("../sql/tracked-events.sql", import.meta.url)
  );
  log(`Loading DDL from ${sqlPath}`);
  const statements = loadSchemaStatements(readFileSync(sqlPath, "utf8"));
  log(`Parsed ${statements.length} statement(s)`);

  const sql = postgres(dsn, { max: 1, prepare: false });

  try {
    const result = await applySchema(sql, statements, log);
    if (!result.ok) {
      log(
        `FAILED at statement #${result.error.index + 1}: ${result.error.reason}`
      );
      log(`Offending statement:\n${result.error.statement}`);
      process.exitCode = 1;
      return;
    }
    log(`OK — ${result.value.applied} statement(s) applied idempotently`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(
    `[apply-schema] fatal: ${error instanceof Error ? error.stack : error}`
  );
  process.exit(1);
});
