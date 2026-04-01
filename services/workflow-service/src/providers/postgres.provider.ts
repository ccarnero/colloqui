import type { FactoryProvider } from "@nestjs/common";
import { createPostgresProvider, POSTGRES_SQL } from "@yoizen/database";
import type { Sql } from "@yoizen/database";

export { POSTGRES_SQL };
export type { Sql };

export const postgresProvider: FactoryProvider<Sql> = createPostgresProvider({
  max: 20,
  connectTimeout: 30,
  prepare: true,
});
