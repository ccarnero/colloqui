import { PostgresModule as BasePostgresModule } from "@yoizen/database";
import { adapterServiceConfig } from "../config";

export { POSTGRES_SQL } from "@yoizen/database";

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
  status            TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
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

const MIGRATION_SQL = `
UPDATE http_adapters
  SET status = 'enabled'
  WHERE status NOT IN ('enabled', 'disabled');

ALTER TABLE http_adapters
  ALTER COLUMN status SET DEFAULT 'enabled';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'http_adapters_status_check'
  ) THEN
    ALTER TABLE http_adapters
      ADD CONSTRAINT http_adapters_status_check
      CHECK (status IN ('enabled', 'disabled'));
  END IF;
END $$;
`;

export const PostgresModule = BasePostgresModule.register({
  defaultHost: adapterServiceConfig.defaultPostgresHost,
  schemaSql: [SCHEMA_SQL, MIGRATION_SQL],
});
