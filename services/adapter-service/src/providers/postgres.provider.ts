import {
  Global,
  Module,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { FactoryProvider } from "@nestjs/common";
import postgres from "postgres";
import type { Sql } from "postgres";

export const POSTGRES_SQL = "POSTGRES_SQL";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS http_adapters (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  context           TEXT NOT NULL CHECK (context IN ('internal', 'external')),
  base_url          TEXT NOT NULL,
  auth_type         TEXT NOT NULL DEFAULT 'none',
  auth_config       JSONB NOT NULL DEFAULT '{}',
  headers           JSONB NOT NULL DEFAULT '[]',
  timeout_ms        INTEGER NOT NULL DEFAULT 5000,
  max_retries       INTEGER NOT NULL DEFAULT 3,
  retry_backoff_ms  INTEGER NOT NULL DEFAULT 1000,
  health_check_path TEXT NOT NULL DEFAULT '/health',
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_http_adapters_tenant
  ON http_adapters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_http_adapters_context
  ON http_adapters (tenant_id, context);

CREATE TABLE IF NOT EXISTS adapter_endpoints (
  id          TEXT PRIMARY KEY,
  adapter_id  TEXT NOT NULL REFERENCES http_adapters(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(adapter_id, method, path)
);
CREATE INDEX IF NOT EXISTS idx_adapter_endpoints_adapter
  ON adapter_endpoints (adapter_id);
`;

const sqlProvider: FactoryProvider<Sql> = {
  provide: POSTGRES_SQL,
  useFactory: (): Sql => {
    const host =
      process.env.POSTGRES_HOST ??
      "postgres.support-services-dev.svc.cluster.local";
    const port = parseInt(process.env.POSTGRES_PORT ?? "5432", 10);
    const database = process.env.POSTGRES_DB ?? "yoizen";
    const username = process.env.POSTGRES_USER ?? "yoizen";
    const password = process.env.POSTGRES_PASSWORD ?? "yoizen-dev-password";

    return postgres({
      host,
      port,
      database,
      username,
      password,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  },
};

class SchemaInitializer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchemaInitializer.name);
  constructor(private readonly sql: Sql) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sql.unsafe(SCHEMA_SQL);
      this.logger.log("Adapter schema ensured");
    } catch (err) {
      this.logger.error("Failed to ensure adapter schema", err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end();
  }
}

const schemaInitProvider = {
  provide: "SCHEMA_INITIALIZER",
  useFactory: (sql: Sql) => new SchemaInitializer(sql),
  inject: [POSTGRES_SQL],
};

@Global()
@Module({
  providers: [sqlProvider, schemaInitProvider],
  exports: [sqlProvider],
})
export class PostgresModule {}
