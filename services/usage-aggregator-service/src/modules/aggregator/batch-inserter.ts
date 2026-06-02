import type { Db } from "mongodb";
import type { Sql } from "@yoizen/database";
import { usageAggregatorServiceConfig } from "../../config";
import type { IChannelEventRow } from "./envelope-parser";
import { insertBatch as insertBatchMongo } from "./batch-inserter.mongo";
import { insertBatch as insertBatchPostgres } from "./batch-inserter.postgres";

/**
 * Inserts a homogeneous usage batch using the active storage engine adapter.
 */
export async function insertBatch(
  connection: Db | Sql,
  rows: readonly IChannelEventRow[],
  tenantId?: string,
): Promise<number> {
  if (usageAggregatorServiceConfig.dbEngine === "postgres") {
    return insertBatchPostgres(connection as Sql, rows, tenantId);
  }
  return insertBatchMongo(connection as Db, rows, tenantId);
}
