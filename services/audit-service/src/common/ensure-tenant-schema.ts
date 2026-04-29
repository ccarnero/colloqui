import type { TenantConnectionManager, Sql } from "@yoizen/database";

/**
 * Runs per-tenant DDL once: skips if the tenant is already marked initialized.
 *
 * Uses {@link TenantConnectionManager.ensureSchema} (async) — NOT the sync
 * `getConnection` — so the per-tenant tier is resolved through the platform
 * catalog and cached BEFORE any pool is opened. Without this, the first
 * request for a dedicated-tier tenant falls back to `defaultTier` (`shared`)
 * and {@link TenantConnectionManager} routes the query at the shared CNPG
 * cluster, where `tenant_<name>` does not exist — the handler then throws
 * `database does not exist` / `role does not exist` and the API returns 500.
 *
 * The first call for a tenant pays one catalog round-trip (`SELECT tier
 * FROM tenants WHERE name = $1 LIMIT 1`); the result is memoized in
 * `tierCache`, so any subsequent sync `getConnection(tenantId)` in the
 * same process resolves correctly in O(1).
 *
 * The init flag delegates to {@link TenantConnectionManager.markInitialized}
 * (and reads via {@link TenantConnectionManager.isInitialized}) so a
 * `platform.tenant.deleted` eviction also clears it — without that, a
 * delete+recreate cycle would short-circuit this guard, skip
 * `ensureSchema`, and leave `tierCache` stale.
 */
export async function ensureTenantSchemaOnce(
  tenantConnections: TenantConnectionManager,
  tenantId: string,
  ddl: (sql: Sql) => Promise<void>,
): Promise<void> {
  if (tenantConnections.isInitialized(tenantId)) return;
  const sql = await tenantConnections.ensureSchema(tenantId);
  await ddl(sql);
  tenantConnections.markInitialized(tenantId);
}

/**
 * Runs DDL once per (namespace, tenantId), independent of core tenant schema init.
 * Used for optional tables (e.g. gateway_audit_events, channel_events).
 *
 * Same async-resolution rationale as {@link ensureTenantSchemaOnce}: the
 * dedicated-tier routing must come from the catalog-backed tier cache, not
 * `defaultTier`.
 *
 * The (namespace, tenantId) flag is owned by
 * {@link TenantConnectionManager.markNamespaceInitialized} so it gets
 * scrubbed by `evictTenant` on a `platform.tenant.deleted` event. A previous
 * version stored this flag in a module-level static `Map` and would
 * silently skip DDL — and skip the catalog tier re-resolution that
 * `ensureSchema` triggers — for any tenant that was deleted+recreated
 * inside the same pod's lifetime, mis-routing dedicated tenants to the
 * shared CNPG cluster on the second run.
 */
export async function ensureTenantNamespaceOnce(
  tenantConnections: TenantConnectionManager,
  tenantId: string,
  namespace: string,
  ddl: (sql: Sql) => Promise<void>,
): Promise<void> {
  if (tenantConnections.isNamespaceInitialized(namespace, tenantId)) return;
  const sql = await tenantConnections.ensureSchema(tenantId);
  await ddl(sql);
  tenantConnections.markNamespaceInitialized(namespace, tenantId);
}
