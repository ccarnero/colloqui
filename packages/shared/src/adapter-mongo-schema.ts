import type { IMongoCollectionSchema } from "./mongo-schema.types";

/**
 * Per-tenant adapter collections + indexes (single source of truth for
 * adapter-service `TenantMongoConnectionManager.setSchema()` and
 * tenant-service provisioning).
 *
 * `tenant_id` is intentionally absent: uniqueness on `name` is scoped to
 * the tenant database.
 */
export const ADAPTER_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "http_adapters",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_http_adapters" },
      },
      {
        keys: { name: 1 },
        options: { unique: true, name: "uniq_http_adapters_name" },
      },
      {
        keys: { context: 1 },
        options: { name: "idx_http_adapters_context" },
      },
      {
        keys: { tags: 1 },
        options: { name: "idx_http_adapters_tags" },
      },
      {
        keys: { managed_by: 1 },
        options: {
          name: "idx_http_adapters_managed_by",
          sparse: true,
        },
      },
    ],
  },
  {
    collection: "adapter_endpoints",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_adapter_endpoints" },
      },
      {
        keys: { adapter_id: 1, method: 1, path: 1 },
        options: {
          unique: true,
          name: "uniq_adapter_endpoints_adapter_method_path",
        },
      },
      {
        keys: { adapter_id: 1 },
        options: { name: "idx_adapter_endpoints_adapter" },
      },
    ],
  },
];
