import { PostgresModule as BasePostgresModule } from "@yoizen/database";
import { channelServiceConfig } from "../config";

export { POSTGRES_SQL } from "@yoizen/database";

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

export const PostgresModule = BasePostgresModule.register({
  defaultHost: channelServiceConfig.defaultPostgresHost,
  schemaSql: [SCHEMA_SQL],
});
