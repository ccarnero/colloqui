import {
  Global,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { FactoryProvider } from "@nestjs/common";
import postgres from "postgres";
import type { Sql } from "postgres";
import { TenantDatabaseTier } from "@yoizen/shared";
import { tenantServiceConfig } from "../config";

export const PLATFORM_POSTGRES_SQL = "PLATFORM_POSTGRES_SQL";

/** Exported for unit tests asserting platform DDL shape. */
export const TENANTS_PLATFORM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT        PRIMARY KEY,
  name          TEXT        UNIQUE NOT NULL,
  tier          TEXT        NOT NULL DEFAULT '${TenantDatabaseTier.Shared}'
                CHECK (tier IN ('${TenantDatabaseTier.Shared}', '${TenantDatabaseTier.Dedicated}')),
  configuration JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provisioning_status         TEXT        NOT NULL DEFAULT 'pending',
  provisioning_error          TEXT,
  provisioning_started_at     TIMESTAMPTZ,
  provisioning_completed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants (name);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tier
  TEXT NOT NULL DEFAULT '${TenantDatabaseTier.Shared}';
ALTER TABLE tenants ALTER COLUMN tier SET DEFAULT '${TenantDatabaseTier.Shared}';
UPDATE tenants
  SET tier = '${TenantDatabaseTier.Shared}'
  WHERE tier IS NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_tier_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_tier_check
      CHECK (tier IN ('${TenantDatabaseTier.Shared}', '${TenantDatabaseTier.Dedicated}'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tenants_tier ON tenants (tier);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioning_status
  TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioning_error TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioning_started_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioning_completed_at TIMESTAMPTZ;
ALTER TABLE tenants ALTER COLUMN provisioning_status SET DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS idx_tenants_provisioning_incomplete
  ON tenants (provisioning_status)
  WHERE provisioning_status IN ('pending', 'provisioning', 'failed');
`;

const sqlProvider: FactoryProvider<Sql> = {
  provide: PLATFORM_POSTGRES_SQL,
  useFactory: (): Sql => {
    const host = tenantServiceConfig.postgresHost;
    const port = tenantServiceConfig.postgresPort;
    const database = tenantServiceConfig.postgresDb;
    const username = tenantServiceConfig.postgresUser;
    const password = tenantServiceConfig.postgresPassword;

    return postgres({
      host,
      port,
      database,
      username,
      password,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: true,
    });
  },
};

class SchemaInitializer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(SchemaInitializer.name);
  constructor(private readonly sql: Sql) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sql.unsafe(TENANTS_PLATFORM_SCHEMA_SQL);
      this.logger.log("Tenants schema ensured");
    } catch (err) {
      this.logger.error("Failed to ensure tenants schema", err);
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end();
  }
}

const schemaInitProvider = {
  provide: "TENANT_SCHEMA_INITIALIZER",
  useFactory: (sql: Sql) => new SchemaInitializer(sql),
  inject: [PLATFORM_POSTGRES_SQL],
};

@Global()
@Module({
  providers: [sqlProvider, schemaInitProvider],
  exports: [sqlProvider],
})
export class PlatformPostgresModule {}
