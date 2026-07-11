import type { IMongoCollectionSchema } from "./mongo-schema.types";

/**
 * Per-tenant workflow collections + indexes (single source of truth for
 * workflow-service `TenantMongoConnectionManager.setSchema()` and
 * tenant-service provisioning).
 *
 * `tenant_id` is intentionally absent: these collections live inside each
 * tenant's own MongoDB database, so the DB itself is the tenant boundary.
 */
export const WORKFLOW_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "workflow_definitions",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_workflow_definitions" },
      },
      {
        // Per-tenant enable/disable toggle lookups (block-new-executions
        // checks and admin console list filtering).
        keys: { status: 1 },
        options: { name: "idx_workflow_definitions_status" },
      },
      {
        keys: { "trigger.type": 1 },
        options: {
          name: "idx_workflow_definitions_trigger_type",
          // Mongo `partialFilterExpression` does NOT support `$ne` (rejected
          // with "Expression not supported in partial index"). We model
          // "trigger is a real subdocument" via `$type: "object"`, which is
          // strictly stronger than `$ne: null` here because the only legal
          // shape for `trigger` is a `{ type, ... }` subdoc; null and
          // missing are excluded for free.
          partialFilterExpression: {
            deleted_at: null,
            trigger: { $type: "object" },
          },
        },
      },
    ],
  },
  {
    collection: "workflow_executions",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_workflow_executions" },
      },
      {
        keys: { definition_id: 1 },
        options: { name: "idx_workflow_executions_definition_id" },
      },
      {
        keys: { temporal_workflow_id: 1, temporal_run_id: 1 },
        options: { name: "idx_workflow_executions_temporal_ids" },
      },
      {
        keys: { definition_id: 1, created_at: -1 },
        options: { name: "idx_workflow_executions_definition_created_at" },
      },
    ],
  },
];
