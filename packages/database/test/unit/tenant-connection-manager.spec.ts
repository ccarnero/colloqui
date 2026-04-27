import { afterEach, describe, expect, it } from "bun:test";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "../../src/tenant-connection-manager";

describe("TenantConnectionManager placement", () => {
  afterEach(() => {
    delete process.env.TENANT_POSTGRES_TIER_OVERRIDES;
    delete process.env.TENANT_POSTGRES_SHARED_HOST;
    delete process.env.TENANT_POSTGRES_SHARED_PASSWORD;
    delete process.env.TENANT_POSTGRES_DEFAULT_TIER;
  });

  it("getConnection targets shared cluster when default tier is shared", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";
    process.env.TENANT_POSTGRES_SHARED_HOST = "postgres-shared.support-services-dev.svc.cluster.local";
    process.env.TENANT_POSTGRES_SHARED_PASSWORD = "tenant-role-password";

    const manager = new TenantConnectionManager();
    const target = await manager.resolveDatabaseTarget("acme-no-override");

    expect(target.tier).toBe("shared");
    expect(target.host).toBe(
      "postgres-shared.support-services-dev.svc.cluster.local",
    );

    await manager.onModuleDestroy();
  });

  it("resolves shared per-tenant database targets from overrides", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";
    process.env.TENANT_POSTGRES_TIER_OVERRIDES = JSON.stringify({
      acme: "shared",
    });
    process.env.TENANT_POSTGRES_SHARED_HOST = "postgres-shared.test.svc";
    process.env.TENANT_POSTGRES_SHARED_PASSWORD = "tenant-password";

    const manager = new TenantConnectionManager();
    const target = await manager.resolveDatabaseTarget("acme");

    expect(target.tier).toBe("shared");
    expect(target.host).toBe("postgres-shared.test.svc");
    expect(target.database).toBe("tenant_acme");
    expect(target.sharedDatabaseMode).toBe(
      SharedTenantDatabaseMode.PerTenantDatabase,
    );
    await manager.onModuleDestroy();
  });
});
