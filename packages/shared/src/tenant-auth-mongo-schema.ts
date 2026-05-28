import type { IMongoCollectionSchema } from "./mongo-schema.types";

/**
 * Per-tenant RBAC and tenant user account collections.
 * Single source of truth for auth-service `AuthTenantMongoConnectionManager`
 * and tenant-service provisioning.
 *
 * `tenant_id` is intentionally absent: these collections live in each tenant's
 * MongoDB. Unique indexes on `name` / `email` replace compound keys scoped
 * by tenant_id in the shared Postgres cluster.
 */
export const TENANT_AUTH_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "tenant_roles",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_tenant_roles" },
      },
      {
        keys: { name: 1 },
        options: { unique: true, name: "uniq_tenant_roles_name" },
      },
    ],
  },
  {
    collection: "tenant_role_permissions",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_tenant_role_permissions" },
      },
      {
        keys: { role_id: 1, resource: 1, action: 1 },
        options: {
          unique: true,
          name: "uniq_tenant_role_permissions_role_resource_action",
        },
      },
      {
        keys: { role_id: 1 },
        options: { name: "idx_tenant_role_permissions_role" },
      },
    ],
  },
  {
    collection: "tenant_users",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_tenant_users" },
      },
      {
        keys: { email: 1 },
        options: { unique: true, name: "uniq_tenant_users_email" },
      },
      {
        keys: { role_id: 1 },
        options: { name: "idx_tenant_users_role" },
      },
    ],
  },
];
