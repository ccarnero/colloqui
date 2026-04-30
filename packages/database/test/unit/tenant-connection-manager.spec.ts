import { afterEach, describe, expect, it } from "bun:test";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "../../src/tenant-connection-manager";
import { type TenantDatabaseTierValue } from "@yoizen/shared";

afterEach(() => {
  delete process.env.TENANT_POSTGRES_TIER_OVERRIDES;
  delete process.env.TENANT_POSTGRES_SHARED_HOST;
  delete process.env.TENANT_POSTGRES_SHARED_PASSWORD;
  delete process.env.TENANT_POSTGRES_DEFAULT_TIER;
  delete process.env.TENANT_POSTGRES_CATALOG_HOST;
  delete process.env.POSTGRES_HOST;
  delete process.env.PLATFORM_ENVIRONMENT;
});

class StubManager extends TenantConnectionManager {
  public lookupCalls = 0;
  public stubResult: TenantDatabaseTierValue | null = null;

  protected override async lookupTenantTier(
    _tenantId: string,
  ): Promise<TenantDatabaseTierValue | null> {
    this.lookupCalls += 1;
    return this.stubResult;
  }

  /** Test-only: surface the sync resolver without opening a real pool. */
  public exposeSyncTier(tenantId: string): TenantDatabaseTierValue {
    return this.resolveTenantTierSync(tenantId);
  }
}

describe("TenantConnectionManager placement", () => {
  it("getConnection targets shared cluster when default tier is shared", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";
    process.env.TENANT_POSTGRES_SHARED_HOST = "postgres-shared.support-services-dev.svc.cluster.local";
    process.env.TENANT_POSTGRES_SHARED_PASSWORD = "tenant-role-password";

    const manager = new StubManager();
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

    const manager = new StubManager();
    const target = await manager.resolveDatabaseTarget("acme");

    expect(target.tier).toBe("shared");
    expect(target.host).toBe("postgres-shared.test.svc");
    expect(target.database).toBe("tenant_acme");
    expect(target.sharedDatabaseMode).toBe(
      SharedTenantDatabaseMode.PerTenantDatabase,
    );
    await manager.onModuleDestroy();
  });

  it("catalog answer for dedicated tenant routes async + sync to dedicated", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";
    process.env.PLATFORM_ENVIRONMENT = "dev";

    const manager = new StubManager();
    manager.stubResult = "dedicated";

    const target = await manager.resolveDatabaseTarget("kaboom");
    expect(target.tier).toBe("dedicated");
    expect(target.host).toBe("postgres.kaboom-dev-ns.svc.cluster.local");

    expect(manager.exposeSyncTier("kaboom")).toBe("dedicated");

    await manager.resolveDatabaseTarget("kaboom");
    expect(manager.lookupCalls).toBe(1);

    await manager.onModuleDestroy();
  });

  it("catalog failures don't get cached and the next call retries", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";

    const manager = new StubManager();
    manager.stubResult = null;

    const first = await manager.resolveDatabaseTarget("kaboom");
    expect(first.tier).toBe("shared");
    expect(manager.exposeSyncTier("kaboom")).toBe("shared");

    manager.stubResult = "dedicated";
    const second = await manager.resolveDatabaseTarget("kaboom");
    expect(second.tier).toBe("dedicated");
    expect(manager.lookupCalls).toBe(2);

    expect(manager.exposeSyncTier("kaboom")).toBe("dedicated");

    await manager.onModuleDestroy();
  });

  it("env override beats catalog answer (catalog never queried)", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";
    process.env.TENANT_POSTGRES_TIER_OVERRIDES = JSON.stringify({
      kaboom: "shared",
    });

    const manager = new StubManager();
    manager.stubResult = "dedicated";

    const target = await manager.resolveDatabaseTarget("kaboom");
    expect(target.tier).toBe("shared");
    expect(manager.lookupCalls).toBe(0);
    expect(manager.exposeSyncTier("kaboom")).toBe("shared");

    await manager.onModuleDestroy();
  });

  it("catalogHost defaults to the platform DB when POSTGRES_HOST is unset", async () => {
    process.env.POSTGRES_PASSWORD = "test-password";
    process.env.PLATFORM_ENVIRONMENT = "qa";

    const manager = new StubManager() as unknown as { catalogHost: string };
    expect(manager.catalogHost).toBe(
      "postgres.support-services-qa.svc.cluster.local",
    );

    await (manager as unknown as TenantConnectionManager).onModuleDestroy();
  });
});
