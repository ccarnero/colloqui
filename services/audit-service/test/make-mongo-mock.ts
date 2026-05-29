import { mock } from "bun:test";
import type { Collection, Db } from "mongodb";
import type { AuditTenantConnectionManager } from "../src/providers/tenant-connection-manager";

export interface IFakeTenantMongoConnections
  extends AuditTenantConnectionManager {
  readonly ensureSchemaCalls: Map<string, number>;
}

/**
 * Stub per-tenant Mongo manager for audit-service unit tests.
 */
export function makeFakeTenantMongoConnections(
  db: Db,
): IFakeTenantMongoConnections {
  const dbByTenant = new Map<string, Db>();
  const ensureSchemaCalls = new Map<string, number>();
  const initialized = new Set<string>();
  const namespaceInitialized = new Map<string, Set<string>>();

  const manager = {
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
    isInitialized: (tenantId: string) => initialized.has(tenantId),
    markInitialized: (tenantId: string) => {
      initialized.add(tenantId);
    },
    isNamespaceInitialized: (namespace: string, tenantId: string) =>
      namespaceInitialized.get(namespace)?.has(tenantId) ?? false,
    markNamespaceInitialized: (namespace: string, tenantId: string) => {
      let set = namespaceInitialized.get(namespace);
      if (!set) {
        set = new Set<string>();
        namespaceInitialized.set(namespace, set);
      }
      set.add(tenantId);
    },
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
  collections: Record<string, Record<string, unknown>> = {},
): Db {
  const existingCollections = new Set(Object.keys(collections));
  return {
    listCollections: mock(() => ({
      toArray: mock(async () =>
        Array.from(existingCollections, (name) => ({ name })),
      ),
    })),
    createCollection: mock(async (name: string) => {
      existingCollections.add(name);
      return {};
    }),
    collection: mock((name: string) => collections[name] ?? {
      createIndex: mock(async () => "idx"),
    }),
  } as unknown as Db;
}

export function makeMongoCollectionMock(
  handlers: Record<string, (...args: unknown[]) => unknown> = {},
): Collection {
  const merged: Record<string, (...args: unknown[]) => unknown> = {
    createIndex: async () => "idx",
    ...handlers,
  };
  return new Proxy(merged, {
    get(target, prop: string | symbol) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return undefined;
      }
      if (typeof prop === "string" && prop in target) {
        const handler = target[prop];
        return typeof handler === "function" ? mock(handler) : handler;
      }
      return mock(async () => undefined);
    },
  }) as unknown as Collection;
}
