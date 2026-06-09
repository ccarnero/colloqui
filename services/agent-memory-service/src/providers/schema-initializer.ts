import type { Sql } from "@yoizen/database";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEMORY_SCHEMA_DDL = readFileSync(
  join(__dirname, "..", "schema", "memory-schema.sql"),
  "utf8",
);

export async function initAgentMemoryTenantSchema(
  _tenantId: string,
  sql: Sql,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET client_min_messages TO WARNING`);
    await tx.unsafe(MEMORY_SCHEMA_DDL);
    await tx.unsafe(`RESET client_min_messages`);
  });
}
