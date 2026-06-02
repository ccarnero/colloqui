import { Global, Module } from "@nestjs/common";
import {
  TENANT_DB_CONNECTION_MANAGER,
  TenantConnectionManager,
  TenantDeletionEvictionListener,
  TenantMongoConnectionManager,
  TenantMongoDeletionEvictionListener,
} from "@yoizen/database";
import { auditServiceConfig } from "../config";
import { AuditTenantConnectionManager } from "./tenant-connection-manager";
import { AuditTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { AuditTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";

const engine = auditServiceConfig.dbEngine;

const tenantManagerClass =
  engine === "postgres"
    ? AuditTenantConnectionManagerPostgres
    : AuditTenantConnectionManagerMongo;

const tenantBaseManagerToken =
  engine === "postgres" ? TenantConnectionManager : TenantMongoConnectionManager;

const tenantEvictionListener =
  engine === "postgres"
    ? TenantDeletionEvictionListener
    : TenantMongoDeletionEvictionListener;

@Global()
@Module({
  providers: [
    {
      provide: AuditTenantConnectionManager,
      useClass: tenantManagerClass,
    },
    {
      provide: TENANT_DB_CONNECTION_MANAGER,
      useExisting: AuditTenantConnectionManager,
    },
    {
      provide: tenantBaseManagerToken,
      useExisting: AuditTenantConnectionManager,
    },
    tenantEvictionListener,
  ],
  exports: [AuditTenantConnectionManager, TENANT_DB_CONNECTION_MANAGER],
})
export class ProvidersModule {}
