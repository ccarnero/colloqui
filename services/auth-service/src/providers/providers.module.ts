import { Global, Module } from "@nestjs/common";
import { REDIS_CLIENT, redisProvider } from "@yoizen/database";
import { POSTGRES_SQL, postgresProvider } from "./postgres.provider";

@Global()
@Module({
  providers: [postgresProvider, redisProvider],
  exports: [POSTGRES_SQL, REDIS_CLIENT],
})
export class ProvidersModule {}
