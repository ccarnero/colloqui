import { mock } from "bun:test";
import type { Sql } from "postgres";
import { AdapterTenantConnectionManager } from "../src/providers/tenant-connection-manager";

/**
 * Shared postgres.js `Sql` test double for adapter-service unit tests.
 */
export function makeSqlTestDouble(
  impl: (
    strings: TemplateStringsArray,
    values: unknown[],
  ) => Promise<unknown>,
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) =>
    impl(strings, values);
  return Object.assign(fn, {
    json: (x: never) => x,
    unsafe: mock((_q: string, _p: unknown[]) => Promise.resolve(undefined)),
  }) as Sql;
}

/**
 * Stub `AdapterTenantConnectionManager` that memoises one `Sql` handle
 * per `tenantId` in a `Map`, so repository unit tests look exactly like
 * they did pre-tenant-scoping. `ensureSchema` also tracks call counts per
 * tenant for tests that need to assert the DDL is only executed once.
 */
export interface IFakeTenantConnections extends AdapterTenantConnectionManager {
  readonly ensureSchemaCalls: Map<string, number>;
}

export function makeFakeTenantConnections(
  sql: Sql,
): IFakeTenantConnections {
  const sqlByTenant = new Map<string, Sql>();
  const ensureSchemaCalls = new Map<string, number>();
  const manager = {
    ensureSchema: async (tenantId: string): Promise<Sql> => {
      ensureSchemaCalls.set(tenantId, (ensureSchemaCalls.get(tenantId) ?? 0) + 1);
      const existing = sqlByTenant.get(tenantId);
      if (existing) return existing;
      sqlByTenant.set(tenantId, sql);
      return sql;
    },
    getConnection: (tenantId: string): Sql => {
      const existing = sqlByTenant.get(tenantId);
      if (existing) return existing;
      sqlByTenant.set(tenantId, sql);
      return sql;
    },
    verifyConnectivity: async (): Promise<boolean> => true,
    ensureSchemaCalls,
  } as unknown as IFakeTenantConnections;
  return manager;
}
