import { mock } from "bun:test";
import type { Db } from "mongodb";
import { WorkflowTenantConnectionManager } from "../src/providers/tenant-connection-manager";

export interface IFakeTenantMongoConnections
  extends WorkflowTenantConnectionManager {
  readonly ensureSchemaCalls: Map<string, number>;
}

/**
 * Stub per-tenant Mongo manager for repository unit tests.
 */
export function makeFakeTenantMongoConnections(
  db: Db,
): IFakeTenantMongoConnections {
  const dbByTenant = new Map<string, Db>();
  const ensureSchemaCalls = new Map<string, number>();
  const manager = {
    ensureSchema: async (tenantId: string): Promise<Db> => {
      ensureSchemaCalls.set(tenantId, (ensureSchemaCalls.get(tenantId) ?? 0) + 1);
      const existing = dbByTenant.get(tenantId);
      if (existing) return existing;
      dbByTenant.set(tenantId, db);
      return db;
    },
    getConnection: (tenantId: string): Db => {
      const existing = dbByTenant.get(tenantId);
      if (existing) return existing;
      dbByTenant.set(tenantId, db);
      return db;
    },
    verifyConnectivity: async (): Promise<boolean> => true,
    ensureSchemaCalls,
  } as unknown as IFakeTenantMongoConnections;
  return manager;
}

export function makeFindChain(
  result: unknown[],
): ReturnType<typeof mock> {
  return mock(() => ({
    sort: mock(() => ({
      skip: mock(() => ({
        limit: mock(() => ({
          toArray: mock(async () => result),
        })),
      })),
      toArray: mock(async () => result),
    })),
  }));
}

export function makeMockDb(
  collections: Record<string, Record<string, unknown>>,
): Db {
  return {
    collection: mock((name: string) => collections[name] ?? {}),
  } as unknown as Db;
}

export function makeMongoCollectionMock(
  handlers: Record<string, (...args: unknown[]) => Promise<unknown>>,
) {
  return handlers;
}
