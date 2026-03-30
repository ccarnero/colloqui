import postgres from 'postgres';
import type { FactoryProvider } from '@nestjs/common';

export const POSTGRES_SQL = 'POSTGRES_SQL';

export type Sql = ReturnType<typeof postgres>;

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

export const postgresProvider: FactoryProvider = {
  provide: POSTGRES_SQL,
  useFactory: (): Sql => {
    const host = process.env.POSTGRES_HOST ?? 'localhost';
    const port = Number(process.env.POSTGRES_PORT) || 5432;
    const database = process.env.POSTGRES_DB ?? 'yoizen';
    const username = process.env.POSTGRES_USER ?? 'yoizen';
    const password = process.env.POSTGRES_PASSWORD ?? 'yoizen-dev-password';

    return postgres({
      host,
      port,
      database,
      username,
      password,
      max: 20,
      idle_timeout: 20,
      connect_timeout: 30,
      prepare: true,
    });
  },
};
