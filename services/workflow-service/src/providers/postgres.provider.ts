import type { DynamicModule } from "@nestjs/common";
import {
  PostgresModule as BasePostgresModule,
  PLATFORM_POSTGRES_POOL_OPTIONS,
  POSTGRES_SQL,
} from "@yoizen/database";
import type { Sql } from "@yoizen/database";

export { POSTGRES_SQL };
export type { Sql };

/**
 * Idempotent DDL for existing databases created before the trigger column.
 * Runs on workflow-service startup (see {@link BasePostgresModule.register}).
 */
const WORKFLOW_DEFINITIONS_TRIGGER_SQL = `
ALTER TABLE workflow_definitions
  ADD COLUMN IF NOT EXISTS trigger JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_type
  ON workflow_definitions (tenant_id, ((trigger->>'type')))
  WHERE deleted_at IS NULL AND trigger IS NOT NULL;
`;

export const PostgresModule: DynamicModule = BasePostgresModule.register({
  ...PLATFORM_POSTGRES_POOL_OPTIONS,
  schemaSql: [WORKFLOW_DEFINITIONS_TRIGGER_SQL],
});
