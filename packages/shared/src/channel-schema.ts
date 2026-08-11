/**
 * Per-tenant channel_accounts + auto_reply_rules DDL.
 * Single source of truth for channel-service `ChannelTenantConnectionManager` and
 * tenant-service provisioning.
 *
 * `tenant_id` is intentionally absent: these tables live in each tenant's
 * Postgres, so the DB is the boundary. `UNIQUE(channel, external_id)` replaces
 * the prior `UNIQUE(tenant_id, channel, external_id)`.
 */
export const CHANNEL_ACCOUNTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS channel_accounts (
  id                 TEXT        PRIMARY KEY,
  channel            TEXT        NOT NULL CHECK (channel IN ('telegram', 'http', 'e2e-tests')),
  -- No DEFAULT: every writer sets \`provider\` explicitly (channel-service's
  -- AccountsController defaults it to the channel itself). The decommissioned
  -- Meta default silently stamped e2e/manifest-created accounts with a
  -- provider value that no longer exists.
  provider           TEXT        NOT NULL,
  name               TEXT        NOT NULL,
  external_id        TEXT        NOT NULL,
  telegram_bot_token TEXT,
  access_token       TEXT        NOT NULL,
  -- Webhook verification secret: Telegram's \`x-telegram-bot-api-secret-token\`
  -- and Http's \`x-http-channel-token\`. NOT Meta-only — it survives.
  app_secret         TEXT,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_channel
  ON channel_accounts (channel);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_external
  ON channel_accounts (external_id);

ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;

-- Tenants provisioned before the Meta decommission still carry a column
-- default pointing at the removed Meta provider; the CREATE TABLE above only
-- governs tenants created from here on. Drop the default so no writer can
-- silently land a decommissioned provider value. Idempotent.
ALTER TABLE channel_accounts
  ALTER COLUMN provider DROP DEFAULT;

-- Re-applied on every schema init so tenants provisioned before a channel was
-- added pick the new value up: the CREATE TABLE above only governs tenants
-- created from here on. Keep this list identical to it — and to the \`Channel\`
-- union and \`CreateAccountDto\`'s \`@IsIn\`.
DO $$
BEGIN
  ALTER TABLE channel_accounts
    DROP CONSTRAINT IF EXISTS channel_accounts_channel_check;
  ALTER TABLE channel_accounts
    ADD CONSTRAINT channel_accounts_channel_check
    CHECK (channel IN ('telegram', 'http', 'e2e-tests'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
`;

export const AUTO_REPLY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auto_reply_rules (
  id              TEXT        PRIMARY KEY,
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
`;
