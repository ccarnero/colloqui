/**
 * Per-tenant workflow tables DDL + indexes (single source of truth for
 * workflow-service `TenantConnectionManager.setSchema()` and
 * tenant-service provisioning).
 *
 * The `tenant_id` column is intentionally absent: these tables live
 * inside each tenant's own Postgres instance, so the DB itself is
 * the tenant boundary.
 *
 * `temporal_workflow_id` remains globally unique because its
 * generation already embeds `tenantId` (see
 * `services/workflow-service/src/modules/workflows/workflows.service.ts`).
 */
export const WORKFLOW_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id          TEXT         PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  application VARCHAR(64)  NOT NULL,
  actions     JSONB        NOT NULL,
  trigger     JSONB        DEFAULT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_type
  ON workflow_definitions (((trigger->>'type')))
  WHERE deleted_at IS NULL AND trigger IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_executions (
  id                    TEXT        PRIMARY KEY,
  definition_id         TEXT        NOT NULL REFERENCES workflow_definitions(id),
  temporal_workflow_id  TEXT        NOT NULL,
  temporal_run_id       TEXT        NOT NULL,
  request               JSONB       NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'RUNNING',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_definition_id
  ON workflow_executions (definition_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_temporal_ids
  ON workflow_executions (temporal_workflow_id, temporal_run_id);
`;
