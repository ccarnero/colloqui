import { afterEach, describe, expect, it } from "bun:test";
import {
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "../../src/tenant-mongo-connection-manager";
import { type TenantDatabaseTierValue } from "@yoizen/shared";

afterEach(() => {
  delete process.env.TENANT_MONGO_TIER_OVERRIDES;
  delete process.env.TENANT_MONGO_SHARED_HOST;
  delete process.env.TENANT_MONGO_SHARED_PASSWORD;
  delete process.env.TENANT_MONGO_DEFAULT_TIER;
  delete process.env.TENANT_MONGO_CATALOG_HOST;
  delete process.env.MONGO_HOST;
  delete process.env.PLATFORM_ENVIRONMENT;
  delete process.env.MONGO_PASSWORD;
});

class StubMongoManager extends TenantMongoConnectionManager {
  public lookupCalls = 0;
  public stubResult: TenantDatabaseTierValue | null = null;

  protected override async lookupTenantTier(
    _tenantId: string,
  ): Promise<TenantDatabaseTierValue | null> {
    this.lookupCalls += 1;
    return this.stubResult;
  }

  public exposeSyncTier(tenantId: string): TenantDatabaseTierValue {
    return this.resolveTenantTierSync(tenantId);
  }
}

describe("TenantMongoConnectionManager placement", () => {
  it("resolveDatabaseTarget targets shared cluster when default tier is shared", async () => {
    process.env.MONGO_PASSWORD = "test-password";
    process.env.TENANT_MONGO_SHARED_HOST =
      "mongo-shared.support-services-dev.svc.cluster.local";
    process.env.TENANT_MONGO_SHARED_PASSWORD = "tenant-role-password";

    const manager = new StubMongoManager();
    const target = await manager.resolveDatabaseTarget("acme-no-override");

    expect(target.tier).toBe("shared");
    expect(target.host).toBe(
      "mongo-shared.support-services-dev.svc.cluster.local",
    );

    await manager.onModuleDestroy();
  });

  it("resolveDatabaseTarget uses dedicated host pattern for dedicated tenants", async () => {
    process.env.MONGO_PASSWORD = "test-password";
    process.env.PLATFORM_ENVIRONMENT = "dev";

    const manager = new StubMongoManager();
    manager.stubResult = "dedicated";

    const target = await manager.resolveDatabaseTarget("kaboom");
    expect(target.tier).toBe("dedicated");
    expect(target.host).toBe("mongo.kaboom-dev-ns.svc.cluster.local");

    await manager.onModuleDestroy();
  });

  it("resolveDatabaseTarget uses single-database shared usage host override", async () => {
    process.env.MONGO_PASSWORD = "test-password";
    process.env.PLATFORM_ENVIRONMENT = "dev";
    process.env.TENANT_MONGO_TIER_OVERRIDES = JSON.stringify({ acme: "shared" });
    process.env.TENANT_MONGO_SHARED_HOST =
      "mongo-usage-shared.support-services-dev.svc.cluster.local";

    const manager = new StubMongoManager();
    manager.configure({
      serviceName: "mongo-usage",
      sharedHost: "mongo-usage-shared.support-services-dev.svc.cluster.local",
      sharedDatabaseMode: SharedTenantDatabaseMode.SingleDatabase,
      sharedDatabase: "yoizen_usage",
    });

    const target = await manager.resolveDatabaseTarget("acme");
    expect(target.host).toBe(
      "mongo-usage-shared.support-services-dev.svc.cluster.local",
    );
    expect(target.database).toBe("yoizen_usage");
    expect(target.sharedDatabaseMode).toBe(
      SharedTenantDatabaseMode.SingleDatabase,
    );

    await manager.onModuleDestroy();
  });
});
