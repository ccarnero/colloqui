import { Global, Module } from "@nestjs/common";
import {
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  SharedTenantDatabaseMode,
} from "@yoizen/database";
import { AgentMemoryTenantConnectionManager } from "./tenant-connection-manager";
import { AgentMemoryTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";

@Global()
@Module({
  providers: [
    {
      provide: AgentMemoryTenantConnectionManager,
      useClass: AgentMemoryTenantConnectionManagerPostgres,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: AgentMemoryTenantConnectionManager,
    },
    {
      provide: TenantConnectionManager,
      useExisting: AgentMemoryTenantConnectionManager,
    },
  ],
  exports: [
    AgentMemoryTenantConnectionManager,
    TENANT_DB_CONNECTION_MANAGER,
  ],
})
export class ProvidersModule {}
