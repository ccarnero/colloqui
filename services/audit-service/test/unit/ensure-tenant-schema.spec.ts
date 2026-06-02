import { describe, it, expect, mock } from "bun:test";
import type { Db } from "mongodb";
import type { TenantMongoConnectionManager } from "@yoizen/database";
import { EVENTS_AUDIT_MONGO_SCHEMA } from "@yoizen/shared";
import {
  ensureTenantSchemaOnce,
  ensureTenantNamespaceOnce,
} from "../../src/common/ensure-tenant-schema";

function makeMockDb(): Db {
  const existingCollections = new Set<string>();
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
    collection: mock((name: string) => ({
      createIndex: mock(async () => "idx"),
      collectionName: name,
    })),
  } as unknown as Db;
}

/**
 * Production code calls `await tenantConnections.ensureSchema(tenantId)`
 * before applying Mongo schema descriptors so the platform-catalog tier
 * lookup runs before any client opens.
 */
describe("ensureTenantSchemaOnce", () => {
  it("runs schema apply once via async ensureSchema, marks initialized, then skips", async () => {
    let initialized = false;
    const dbStub = makeMockDb();
    const ensureSchema = mock(async (_id: string) => dbStub);
    const markInitialized = mock((id: string) => {
      expect(id).toBe("t1");
      initialized = true;
    });
    const tenantConnections = {
      isInitialized: () => initialized,
      ensureSchema,
      markInitialized,
      getConnection: () => dbStub,
    } as unknown as TenantMongoConnectionManager;

    await ensureTenantSchemaOnce(
      tenantConnections,
      "t1",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    await ensureTenantSchemaOnce(
      tenantConnections,
      "t1",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );

    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(markInitialized).toHaveBeenCalledTimes(1);
    expect(dbStub.createCollection).toHaveBeenCalled();
  });

  it("skips schema apply when already initialized", async () => {
    const dbStub = makeMockDb();
    const ensureSchema = mock(async (_id: string) => dbStub);
    const markInitialized = mock(() => {});
    const tenantConnections = {
      isInitialized: () => true,
      ensureSchema,
      markInitialized,
      getConnection: () => dbStub,
    } as unknown as TenantMongoConnectionManager;

    await ensureTenantSchemaOnce(
      tenantConnections,
      "t1",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(markInitialized).not.toHaveBeenCalled();
    expect(dbStub.createCollection).not.toHaveBeenCalled();
  });
});

describe("ensureTenantNamespaceOnce", () => {
  function makeFakeManager(initialFlags: Map<string, Set<string>> = new Map()): {
    manager: TenantMongoConnectionManager;
    isNamespaceInitialized: ReturnType<typeof mock>;
    markNamespaceInitialized: ReturnType<typeof mock>;
    ensureSchema: ReturnType<typeof mock>;
    db: Db;
  } {
    const db = makeMockDb();
    const isNamespaceInitialized = mock(
      (namespace: string, tenantId: string) =>
        initialFlags.get(namespace)?.has(tenantId) ?? false,
    );
    const markNamespaceInitialized = mock(
      (namespace: string, tenantId: string) => {
        let set = initialFlags.get(namespace);
        if (!set) {
          set = new Set();
          initialFlags.set(namespace, set);
        }
        set.add(tenantId);
      },
    );
    const ensureSchema = mock(async (_id: string) => db);
    const manager = {
      isNamespaceInitialized,
      markNamespaceInitialized,
      ensureSchema,
      getConnection: () => db,
    } as unknown as TenantMongoConnectionManager;
    return { manager, isNamespaceInitialized, markNamespaceInitialized, ensureSchema, db };
  }

  it("runs schema apply once per (namespace, tenantId) and skips on second call", async () => {
    const { manager, ensureSchema, markNamespaceInitialized, db } =
      makeFakeManager();

    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );

    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(markNamespaceInitialized).toHaveBeenCalledTimes(1);
    expect(markNamespaceInitialized).toHaveBeenCalledWith("gw", "t1");
    expect(db.createCollection).toHaveBeenCalled();
  });

  it("isolates init state per namespace (same tenant in two namespaces both run)", async () => {
    const { manager, ensureSchema, db } = makeFakeManager();

    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw_a",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw_b",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );

    expect(ensureSchema).toHaveBeenCalledTimes(2);
    expect(db.createCollection).toHaveBeenCalled();
  });

  it("re-runs ensureSchema after the manager clears the namespace flag", async () => {
    const { manager, ensureSchema, markNamespaceInitialized, db } =
      makeFakeManager();

    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    expect(ensureSchema).toHaveBeenCalledTimes(1);

    (manager.isNamespaceInitialized as unknown as ReturnType<typeof mock>).mockImplementation(
      () => false,
    );

    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );
    expect(ensureSchema).toHaveBeenCalledTimes(2);
    expect(markNamespaceInitialized).toHaveBeenCalledTimes(2);
    expect(db.createCollection).toHaveBeenCalled();
  });

  it("skips schema apply when manager reports the (namespace, tenantId) is already initialized", async () => {
    const { manager, ensureSchema, markNamespaceInitialized, db } =
      makeFakeManager(new Map([["gw", new Set(["t1"])]])) ;

    await ensureTenantNamespaceOnce(
      manager,
      "t1",
      "gw",
      EVENTS_AUDIT_MONGO_SCHEMA,
    );

    expect(ensureSchema).not.toHaveBeenCalled();
    expect(markNamespaceInitialized).not.toHaveBeenCalled();
    expect(db.createCollection).not.toHaveBeenCalled();
  });
});
