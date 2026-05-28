import type { Sql, TenantConnectionManager } from "@yoizen/database";

/**
 * Runs per-tenant DDL once: skips if the tenant is already marked initialized.
 */
export async function ensurePostgresTenantSchemaOnce(
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
 */
export async function ensurePostgresTenantNamespaceOnce(
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
