import type { TenantConnectionManager, Sql } from "@yoizen/database";

/**
 * Runs per-tenant DDL once: skips if the tenant is already marked initialized.
 */
export async function ensureTenantSchemaOnce(
  tenantConnections: TenantConnectionManager,
  tenantId: string,
  ddl: (sql: Sql) => Promise<void>,
): Promise<void> {
  if (tenantConnections.isInitialized(tenantId)) return;
  const sql = tenantConnections.getConnection(tenantId);
  await ddl(sql);
  tenantConnections.markInitialized(tenantId);
}

/** namespace -> set of tenantIds that have run namespace DDL */
const namespaceInitialized = new Map<string, Set<string>>();

/**
 * Runs DDL once per (namespace, tenantId), independent of core tenant schema init.
 * Used for optional tables (e.g. gateway_audit_events, channel_events).
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
  const sql = tenantConnections.getConnection(tenantId);
  await ddl(sql);
  set.add(tenantId);
}
