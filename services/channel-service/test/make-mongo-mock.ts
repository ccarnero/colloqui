import { mock } from "bun:test";
import type { Db } from "mongodb";
import { ChannelTenantConnectionManager } from "../src/providers/channel-tenant-connection-manager";

export interface IFakeTenantMongoConnections {
  ensureSchema(tenantId: string): Promise<Db>;
  getConnection(tenantId: string): Db;
  verifyConnectivity(): Promise<boolean>;
  readonly ensureSchemaCalls: Map<string, number>;
}

/** Stub per-tenant Mongo manager for repository unit tests. */
export function makeFakeTenantMongoConnections(
  db: Db,
): IFakeTenantMongoConnections {
  const dbByTenant = new Map<string, Db>();
  const ensureSchemaCalls = new Map<string, number>();
  return {
    ensureSchema: async (tenantId: string): Promise<Db> => {
      ensureSchemaCalls.set(
        tenantId,
        (ensureSchemaCalls.get(tenantId) ?? 0) + 1,
      );
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
  return new Proxy(handlers, {
    get(target, prop: string) {
      if (prop in target) {
        return mock(target[prop]);
      }
      return mock(async () => undefined);
    },
  });
}
