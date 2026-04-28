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

describe("ensureTenantNamespaceOnce", () => {
  it("runs ddl once per namespace and tenant via async ensureSchema", async () => {
    const ns = `gw_${Math.random().toString(36).slice(2)}`;
    const ddl = mock(async (_sql: Sql) => {});
    const ensureSchema = mock(async (_id: string) => ({}) as Sql);
    const tenantConnections = {
      ensureSchema,
    } as unknown as TenantConnectionManager;

    await ensureTenantNamespaceOnce(tenantConnections, "t1", ns, ddl);
    await ensureTenantNamespaceOnce(tenantConnections, "t1", ns, ddl);

    expect(ddl).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith("t1");
  });

  it("isolates init state per namespace (same tenant in two namespaces both run)", async () => {
    const nsA = `gw_a_${Math.random().toString(36).slice(2)}`;
    const nsB = `gw_b_${Math.random().toString(36).slice(2)}`;
    const ddl = mock(async (_sql: Sql) => {});
    const ensureSchema = mock(async (_id: string) => ({}) as Sql);
    const tenantConnections = {
      ensureSchema,
    } as unknown as TenantConnectionManager;

    await ensureTenantNamespaceOnce(tenantConnections, "t1", nsA, ddl);
    await ensureTenantNamespaceOnce(tenantConnections, "t1", nsB, ddl);

    expect(ddl).toHaveBeenCalledTimes(2);
    expect(ensureSchema).toHaveBeenCalledTimes(2);
  });
});
