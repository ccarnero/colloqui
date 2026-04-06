import type { FactoryProvider } from "@nestjs/common";
import {
  createPostgresProvider,
  PLATFORM_POSTGRES_POOL_OPTIONS,
  POSTGRES_SQL,
} from "@yoizen/database";
import type { Sql } from "@yoizen/database";

export { POSTGRES_SQL };
export type { Sql };

export const postgresProvider: FactoryProvider<Sql> = createPostgresProvider(
  PLATFORM_POSTGRES_POOL_OPTIONS,
);
