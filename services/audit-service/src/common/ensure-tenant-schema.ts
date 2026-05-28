import type { Db } from "mongodb";
import {
  applyMongoSchema,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import type { IMongoCollectionSchema } from "@yoizen/shared";

/**
 * Ensures per-tenant Mongo collections/indexes once via async tier resolution.
 *
 * Calls {@link TenantMongoConnectionManager.ensureSchema} (not sync
 * `getConnection`) so dedicated-tier tenants resolve through the platform
 * catalog before any client opens. The init flag delegates to
 * {@link TenantMongoConnectionManager.markInitialized} so eviction on
 * `platform.tenant.deleted` clears it.
 */
export async function ensureTenantSchemaOnce(
  tenantConnections: TenantMongoConnectionManager,
  tenantId: string,
  schemas: IMongoCollectionSchema[],
): Promise<Db> {
  if (tenantConnections.isInitialized(tenantId)) {
    return tenantConnections.getConnection(tenantId);
  }
  const db = await tenantConnections.ensureSchema(tenantId);
  await applyMongoSchema(db, schemas);
  tenantConnections.markInitialized(tenantId);
  return db;
}

/**
 * Ensures optional audit collections once per (namespace, tenantId).
 *
 * Same async-resolution rationale as {@link ensureTenantSchemaOnce}. The
 * (namespace, tenantId) flag is owned by
 * {@link TenantMongoConnectionManager.markNamespaceInitialized} so eviction
 * clears it on tenant delete+recreate cycles.
 */
export async function ensureTenantNamespaceOnce(
  tenantConnections: TenantMongoConnectionManager,
  tenantId: string,
  namespace: string,
  schemas: IMongoCollectionSchema[],
): Promise<Db> {
  if (tenantConnections.isNamespaceInitialized(namespace, tenantId)) {
    return tenantConnections.getConnection(tenantId);
  }
  const db = await tenantConnections.ensureSchema(tenantId);
  await applyMongoSchema(db, schemas);
  tenantConnections.markNamespaceInitialized(namespace, tenantId);
  return db;
}
