import {
  Global,
  InternalServerErrorException,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { FactoryProvider } from '@nestjs/common';
import postgres from 'postgres';
import type { Sql } from 'postgres';

export const PLATFORM_POSTGRES_SQL = 'PLATFORM_POSTGRES_SQL';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT        PRIMARY KEY,
  name          TEXT        UNIQUE NOT NULL,
  configuration JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants (name);
`;

const sqlProvider: FactoryProvider<Sql> = {
  provide: PLATFORM_POSTGRES_SQL,
  useFactory: (): Sql => {
    const host =
      process.env.POSTGRES_HOST ??
      'postgres.support-services-dev.svc.cluster.local';
    const port = parseInt(process.env.POSTGRES_PORT ?? '5432', 10);
    const database = process.env.POSTGRES_DB ?? 'yoizen';
    const username = process.env.POSTGRES_USER ?? 'yoizen';
    const password = process.env.POSTGRES_PASSWORD;
    if (!password) {
      throw new InternalServerErrorException(
        "POSTGRES_PASSWORD environment variable is required",
      );
    }

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
  private readonly logger = new Logger(SchemaInitializer.name);
  constructor(private readonly sql: Sql) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.sql.unsafe(SCHEMA_SQL);
      this.logger.log('Tenants schema ensured');
    } catch (err) {
      this.logger.error('Failed to ensure tenants schema', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sql.end();
  }
}

const schemaInitProvider = {
  provide: 'TENANT_SCHEMA_INITIALIZER',
  useFactory: (sql: Sql) => new SchemaInitializer(sql),
  inject: [PLATFORM_POSTGRES_SQL],
};

@Global()
@Module({
  providers: [sqlProvider, schemaInitProvider],
  exports: [sqlProvider],
})
export class PlatformPostgresModule {}
