import type { FactoryProvider } from "@nestjs/common";
import {
  createPostgresProvider,
  PLATFORM_POSTGRES_POOL_OPTIONS,
} from "@yoizen/database";
import type postgres from "postgres";

export { POSTGRES_SQL } from "@yoizen/database";
export type { Sql } from "@yoizen/database";

/**
 * postgres.js `TransactionSql` loses its call signature due to `Omit`.
 * This restores the tagged-template callable shape for `sql.begin()` callbacks.
 */
export type TxSql = {
  <T extends readonly (object | undefined)[]>(
    template: TemplateStringsArray,
    ...parameters: readonly unknown[]
  ): postgres.PendingQuery<T>;
};

export const postgresProvider: FactoryProvider = createPostgresProvider(
  PLATFORM_POSTGRES_POOL_OPTIONS,
);
