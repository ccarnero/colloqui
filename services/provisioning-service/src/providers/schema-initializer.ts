import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "@yoizen/database";

const MANIFEST_SCHEMA_DDL = readFileSync(
  join(__dirname, "..", "schema", "manifest-schema.sql"),
  "utf8"
);

export async function initProvisioningTenantSchema(
  _tenantId: string,
  sql: Sql
): Promise<void> {
  await sql.unsafe(MANIFEST_SCHEMA_DDL);
}
