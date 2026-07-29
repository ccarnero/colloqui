/**
 * Per-tenant adapter tables DDL + indexes (single source of truth for
 * adapter-service `TenantConnectionManager.setSchema()` and
 * tenant-service provisioning).
 *
 * The `tenant_id` column is intentionally absent: these tables live
 * inside each tenant's own Postgres instance, so the DB itself is
 * the tenant boundary. `UNIQUE(name)` replaces the prior
 * `UNIQUE(tenant_id, name)` because uniqueness is already implicitly
 * scoped to the tenant's DB.
 *
 * `IF NOT EXISTS` is used everywhere so the DDL is idempotent and can
 * run on every `ensureSchema(tenantId)` call for tenants provisioned
 * before this module landed.
 */
/**
 * Upper bounds for the adapter resilience knobs (`timeout_ms`,
 * `max_retries`, `retry_backoff_ms`).
 *
 * Single source of truth: the connector-admin DTOs import these for
 * `@Max(...)` validation so an operator cannot persist an adapter whose
 * per-request budget (`timeoutMs * (maxRetries + 1)` plus backoff) blows
 * past what upstream callers are willing to wait for. Never duplicate
 * these numbers — import them.
 */
export const ADAPTER_TIMEOUT_MS_MAX = 60_000;
export const ADAPTER_MAX_RETRIES_MAX = 3;
export const ADAPTER_RETRY_BACKOFF_MS_MAX = 10_000;

export const ADAPTER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS http_adapters (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  context                TEXT NOT NULL CHECK (context IN ('internal', 'external')),
  base_url               TEXT NOT NULL,
  auth_type              TEXT NOT NULL DEFAULT 'none',
  auth_config            JSONB NOT NULL DEFAULT '{}',
  headers                JSONB NOT NULL DEFAULT '[]',
  default_cache_strategy JSONB,
  timeout_ms             INTEGER NOT NULL DEFAULT 5000,
  max_retries            INTEGER NOT NULL DEFAULT 3,
  retry_backoff_ms       INTEGER NOT NULL DEFAULT 1000,
  health_check_path      TEXT NOT NULL DEFAULT '/health',
  status                 TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  is_encrypted           BOOLEAN NOT NULL DEFAULT false,
  tags                   TEXT[] NOT NULL DEFAULT '{}',
  managed_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name)
);
CREATE INDEX IF NOT EXISTS idx_http_adapters_context
  ON http_adapters (context);
CREATE INDEX IF NOT EXISTS idx_http_adapters_tags
  ON http_adapters USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_http_adapters_managed_by
  ON http_adapters (managed_by)
  WHERE managed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS adapter_endpoints (
  id             TEXT PRIMARY KEY,
  adapter_id     TEXT NOT NULL REFERENCES http_adapters(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  method         TEXT NOT NULL,
  path           TEXT NOT NULL,
  cache_strategy JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(adapter_id, method, path)
);
CREATE INDEX IF NOT EXISTS idx_adapter_endpoints_adapter
  ON adapter_endpoints (adapter_id);
`;
