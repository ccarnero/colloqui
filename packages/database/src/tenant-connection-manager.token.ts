/** DI token for the active per-tenant connection manager (Postgres or Mongo). */
export const TENANT_DB_CONNECTION_MANAGER = Symbol(
  "TENANT_DB_CONNECTION_MANAGER",
);

/**
 * Minimal surface shared by {@link TenantConnectionManager} and
 * {@link TenantMongoConnectionManager} for engine-agnostic injection.
 */
export interface ITenantDbConnectionManager {
  ensureSchema(tenantId: string, namespace: string): Promise<void>;
  getConnection(tenantId: string): Promise<unknown>;
  evictTenant(tenantId: string): void;
  verifyConnectivity(tenantId: string): Promise<boolean>;
}


