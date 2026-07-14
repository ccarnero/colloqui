import { Global, Module } from "@nestjs/common";
import {
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
} from "@yoizen/database";
import { ProvisioningTenantConnectionManager } from "./tenant-connection-manager";
import { ProvisioningTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";

@Global()
@Module({
  providers: [
    {
      provide: ProvisioningTenantConnectionManager,
      useClass: ProvisioningTenantConnectionManagerPostgres,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: ProvisioningTenantConnectionManager,
    },
    {
      provide: TenantConnectionManager,
      useExisting: ProvisioningTenantConnectionManager,
    },
  ],
  exports: [ProvisioningTenantConnectionManager, TENANT_DB_CONNECTION_MANAGER],
})
export class ProvidersModule {}
