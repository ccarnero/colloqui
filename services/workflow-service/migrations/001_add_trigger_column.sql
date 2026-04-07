-- Add trigger JSONB column to workflow_definitions for event-driven execution.
--
-- workflow-service applies the same DDL on startup (PostgresModule schemaSql).
-- Use this file only for manual DBA runs or when CONCURRENTLY is required
-- (large tables; cannot run inside a transaction).

ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS trigger JSONB DEFAULT NULL;

-- Non-concurrent index (safe for small/medium tables, runs in one transaction):
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_type
  ON workflow_definitions (tenant_id, ((trigger->>'type')))
  WHERE deleted_at IS NULL AND trigger IS NOT NULL;

-- For zero-downtime on very large tables, run separately outside any transaction:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_definitions_trigger_type ...
