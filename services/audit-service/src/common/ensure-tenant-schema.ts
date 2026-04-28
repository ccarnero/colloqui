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

/** namespace -> set of tenantIds that have run namespace DDL */
const namespaceInitialized = new Map<string, Set<string>>();

/**
 * Runs DDL once per (namespace, tenantId), independent of core tenant schema init.
 * Used for optional tables (e.g. gateway_audit_events, channel_events).
 *
 * Same async-resolution rationale as {@link ensureTenantSchemaOnce}: the
 * dedicated-tier routing must come from the catalog-backed tier cache, not
 * `defaultTier`.
 */
export async function ensureTenantNamespaceOnce(
  tenantConnections: TenantConnectionManager,
  tenantId: string,
  namespace: string,
  ddl: (sql: Sql) => Promise<void>,
): Promise<void> {
  let set = namespaceInitialized.get(namespace);
  if (!set) {
    set = new Set();
    namespaceInitialized.set(namespace, set);
  }
  if (set.has(tenantId)) return;
  const sql = await tenantConnections.ensureSchema(tenantId);
  await ddl(sql);
  set.add(tenantId);
}
