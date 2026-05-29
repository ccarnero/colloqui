import { Global, Module } from "@nestjs/common";
import { tenantServiceConfig } from "../config";
import { MongoModule } from "./mongo.provider";
import { PostgresModule } from "./postgres.provider";
import { UsagePostgresModule } from "./postgres-usage.provider";
import { PlatformMongoModule } from "./platform-mongo.provider";
import { PlatformPostgresModule } from "./platform-postgres.provider";
import { TENANT_PROVISIONER } from "./tenant-provisioner.interface";
import { TenantMongoProvisionerAdapter } from "./tenant-provisioner.mongo";
import { TenantPostgresProvisionerAdapter } from "./tenant-provisioner.postgres";

const engine = tenantServiceConfig.dbEngine;

const provisionerProvider =
  engine === "postgres"
    ? {
        provide: TENANT_PROVISIONER,
        useClass: TenantPostgresProvisionerAdapter,
      }
    : {
        provide: TENANT_PROVISIONER,
        useClass: TenantMongoProvisionerAdapter,
      };

@Global()
@Module({
  imports:
    engine === "postgres"
      ? [PostgresModule, UsagePostgresModule, PlatformPostgresModule]
      : [MongoModule, PlatformMongoModule],
  providers: [provisionerProvider],
  exports: [TENANT_PROVISIONER],
})
export class TenantDatabaseModule {}
