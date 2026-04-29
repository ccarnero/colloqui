import { describe, it, expect, mock } from "bun:test";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import {
  ensureTenantSchemaOnce,
  ensureTenantNamespaceOnce,
} from "../../src/common/ensure-tenant-schema";

/**
 * Production code calls `await tenantConnections.ensureSchema(tenantId)`
 * (NOT the sync `getConnection`) so the platform-catalog tier lookup runs
 * before any pool is opened. These tests assert on `ensureSchema` being
 * the resolution path so a regression to the sync fast-path (which
 * mis-routes dedicated tenants to the shared cluster and 500s) gets
 * caught here at unit-test time.
 */
describe("ensureTenantSchemaOnce", () => {
  it("runs ddl once via async ensureSchema, marks initialized, then skips", async () => {
    let initialized = false;
    const sqlStub = {} as Sql;
    const ddl = mock(async (_sql: Sql) => {});
    const ensureSchema = mock(async (_id: string) => sqlStub);
    const markInitialized = mock((id: string) => {
      expect(id).toBe("t1");
      initialized = true;
    });
    const tenantConnections = {
      isInitialized: () => initialized,
      ensureSchema,
      markInitialized,
    } as unknown as TenantConnectionManager;

    await ensureTenantSchemaOnce(tenantConnections, "t1", ddl);
    await ensureTenantSchemaOnce(tenantConnections, "t1", ddl);

    expect(ddl).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(markInitialized).toHaveBeenCalledTimes(1);
  });

  it("skips ddl when already initialized (no async tier resolution either)", async () => {
    const ddl = mock(async (_sql: Sql) => {});
    const ensureSchema = mock(async (_id: string) => ({}) as Sql);
    const markInitialized = mock(() => {});
    const tenantConnections = {
      isInitialized: () => true,
      ensureSchema,
      markInitialized,
    } as unknown as TenantConnectionManager;

    await ensureTenantSchemaOnce(tenantConnections, "t1", ddl);
    expect(ddl).not.toHaveBeenCalled();
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(markInitialized).not.toHaveBeenCalled();
  });
});

/**
 * The (namespace, tenantId) flag MUST live on the manager (not in a
 * module-level static) so eviction on `platform.tenant.deleted` clears
 * it. These tests pin the helper to the manager API and assert on
 * lookup order so a regression to the static map gets caught.
 */
describe("ensureTenantNamespaceOnce", () => {
  function makeFakeManager(initialFlags: Map<string, Set<string>> = new Map()): {
    manager: TenantConnectionManager;
    isNamespaceInitialized: ReturnType<typeof mock>;
    markNamespaceInitialized: ReturnType<typeof mock>;
    ensureSchema: ReturnType<typeof mock>;
  } {
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
    const ensureSchema = mock(async (_id: string) => ({}) as Sql);
    const manager = {
      isNamespaceInitialized,
      markNamespaceInitialized,
      ensureSchema,
    } as unknown as TenantConnectionManager;
    return { manager, isNamespaceInitialized, markNamespaceInitialized, ensureSchema };
  }

  it("runs ddl once per (namespace, tenantId) and skips on second call", async () => {
    const ddl = mock(async (_sql: Sql) => {});
    const { manager, ensureSchema, markNamespaceInitialized } = makeFakeManager();

    await ensureTenantNamespaceOnce(manager, "t1", "gw", ddl);
    await ensureTenantNamespaceOnce(manager, "t1", "gw", ddl);

    expect(ddl).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(markNamespaceInitialized).toHaveBeenCalledTimes(1);
    expect(markNamespaceInitialized).toHaveBeenCalledWith("gw", "t1");
  });

  it("isolates init state per namespace (same tenant in two namespaces both run)", async () => {
    const ddl = mock(async (_sql: Sql) => {});
    const { manager, ensureSchema } = makeFakeManager();

    await ensureTenantNamespaceOnce(manager, "t1", "gw_a", ddl);
    await ensureTenantNamespaceOnce(manager, "t1", "gw_b", ddl);

    expect(ddl).toHaveBeenCalledTimes(2);
    expect(ensureSchema).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression for the second-run dedicated-tenant 500: when the manager
   * reports the (namespace, tenantId) is no longer initialized (because
   * `evictTenant` cleared it on `platform.tenant.deleted`), the helper
   * MUST re-run `ensureSchema` so the catalog tier is re-resolved before
   * any pool opens — otherwise the next sync `getConnection` falls back
   * to `defaultTier=shared` and mis-routes a dedicated tenant.
   */
  it("re-runs ensureSchema after the manager clears the namespace flag (post-evict cycle)", async () => {
    const ddl = mock(async (_sql: Sql) => {});
    const { manager, ensureSchema, markNamespaceInitialized } = makeFakeManager();

    await ensureTenantNamespaceOnce(manager, "t1", "gw", ddl);
    expect(ensureSchema).toHaveBeenCalledTimes(1);

    // Simulate `evictTenant` clearing the flag.
    (manager.isNamespaceInitialized as unknown as ReturnType<typeof mock>).mockImplementation(
      () => false,
    );

    await ensureTenantNamespaceOnce(manager, "t1", "gw", ddl);
    expect(ensureSchema).toHaveBeenCalledTimes(2);
    expect(ddl).toHaveBeenCalledTimes(2);
    expect(markNamespaceInitialized).toHaveBeenCalledTimes(2);
  });

  it("skips ddl when manager reports the (namespace, tenantId) is already initialized", async () => {
    const ddl = mock(async (_sql: Sql) => {});
    const { manager, ensureSchema, markNamespaceInitialized } = makeFakeManager(
      new Map([["gw", new Set(["t1"])]]),
    );

    await ensureTenantNamespaceOnce(manager, "t1", "gw", ddl);

    expect(ddl).not.toHaveBeenCalled();
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(markNamespaceInitialized).not.toHaveBeenCalled();
  });
});
