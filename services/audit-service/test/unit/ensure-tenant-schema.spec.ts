import { describe, it, expect, mock } from "bun:test";
import type { Sql } from "@yoizen/database";
import {
  ensureTenantSchemaOnce,
  ensureTenantNamespaceOnce,
} from "../../src/common/ensure-tenant-schema";

describe("ensureTenantSchemaOnce", () => {
  it("runs ddl once, marks initialized, then skips", async () => {
    let initialized = false;
    const ddl = mock(async (_sql: Sql) => {});
    const tenantConnections = {
      isInitialized: mock(() => initialized),
      getConnection: mock(() => ({} as Sql)),
      markInitialized: mock((id: string) => {
        expect(id).toBe("t1");
        initialized = true;
      }),
    };

    await ensureTenantSchemaOnce(tenantConnections, "t1", ddl);
    await ensureTenantSchemaOnce(tenantConnections, "t1", ddl);

    expect(ddl).toHaveBeenCalledTimes(1);
    expect(tenantConnections.markInitialized).toHaveBeenCalledTimes(1);
  });

  it("skips ddl when already initialized", async () => {
    const ddl = mock(async (_sql: Sql) => {});
    const tenantConnections = {
      isInitialized: mock(() => true),
      getConnection: mock(() => ({} as Sql)),
      markInitialized: mock(),
    };

    await ensureTenantSchemaOnce(tenantConnections, "t1", ddl);
    expect(ddl).not.toHaveBeenCalled();
    expect(tenantConnections.markInitialized).not.toHaveBeenCalled();
  });
});

describe("ensureTenantNamespaceOnce", () => {
  it("runs ddl once per namespace and tenant", async () => {
    const ns = `gw_${Math.random().toString(36).slice(2)}`;
    const ddl = mock(async (_sql: Sql) => {});
    const tenantConnections = {
      getConnection: mock(() => ({} as Sql)),
    };

    await ensureTenantNamespaceOnce(tenantConnections, "t1", ns, ddl);
    await ensureTenantNamespaceOnce(tenantConnections, "t1", ns, ddl);

    expect(ddl).toHaveBeenCalledTimes(1);
  });
});
