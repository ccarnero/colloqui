import { Global, Module } from "@nestjs/common";
import { REDIS_CLIENT, redisProvider } from "@yoizen/database";
import { POSTGRES_SQL, postgresProvider } from "./postgres.provider";
import { AuthTenantConnectionManager } from "./auth-tenant-connection-manager";

@Global()
@Module({
  providers: [postgresProvider, redisProvider, AuthTenantConnectionManager],
  exports: [POSTGRES_SQL, REDIS_CLIENT, AuthTenantConnectionManager],
})
export class ProvidersModule {}
