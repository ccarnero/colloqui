/**
 * Per-tenant `metrics` table DDL + indexes (single source of truth for
 * metrics-service and tenant-service provisioning).
 */
export const METRICS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS metrics (
  id          TEXT             PRIMARY KEY,
  source      TEXT             NOT NULL,
  name        TEXT             NOT NULL,
  value       DOUBLE PRECISION NOT NULL DEFAULT 0,
  tags        JSONB            NOT NULL DEFAULT '{}',
  metadata    JSONB            NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics (source);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics (name);
CREATE INDEX IF NOT EXISTS idx_metrics_source_created ON metrics (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics (created_at DESC);
`;
