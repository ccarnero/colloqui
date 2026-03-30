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
CREATE TABLE IF NOT EXISTS channel_accounts (
  id                TEXT        PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  channel           TEXT        NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'telegram')),
  provider          TEXT        NOT NULL DEFAULT 'meta',
  name              TEXT        NOT NULL,
  external_id       TEXT        NOT NULL,
  phone_number_id   TEXT,
  waba_id           TEXT,
  ig_user_id        TEXT,
  telegram_bot_token TEXT,
  access_token      TEXT        NOT NULL,
  app_id            TEXT,
  app_secret        TEXT,
  verify_token      TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant
  ON channel_accounts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_channel
  ON channel_accounts (tenant_id, channel);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_external
  ON channel_accounts (external_id);

-- Telegram support: add column + widen CHECK for existing tables
ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;

DO $$
BEGIN
  ALTER TABLE channel_accounts
    DROP CONSTRAINT IF EXISTS channel_accounts_channel_check;
  ALTER TABLE channel_accounts
    ADD CONSTRAINT channel_accounts_channel_check
    CHECK (channel IN ('whatsapp', 'instagram', 'telegram'));
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS channel_messages (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL,
  account_id          TEXT        NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  channel             TEXT        NOT NULL,
  provider            TEXT        NOT NULL DEFAULT 'meta',
  direction           TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider_message_id TEXT,
  contact_id          TEXT        NOT NULL,
  message_type        TEXT        NOT NULL,
  content             JSONB       NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'received',
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_tenant
  ON channel_messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_account
  ON channel_messages (account_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_contact
  ON channel_messages (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_created
  ON channel_messages (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auto_reply_rules (
  id              TEXT        PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  account_id      TEXT        NOT NULL REFERENCES channel_accounts(id) ON DELETE CASCADE,
  channel         TEXT        NOT NULL,
  trigger_pattern TEXT        NOT NULL,
  reply_text      TEXT        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_account
  ON auto_reply_rules (account_id);
CREATE INDEX IF NOT EXISTS idx_auto_reply_rules_tenant
  ON auto_reply_rules (tenant_id);
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
      this.logger.log("Channel schema ensured");
    } catch (err) {
      this.logger.error("Failed to ensure channel schema", err);
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
