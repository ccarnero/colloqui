import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Db } from "mongodb";
import { YoizenclawTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { TenantScopedMongoRepository } from "../../src/providers/tenant-scoped.repository";

class TestTenantRepository extends TenantScopedMongoRepository {
  public constructor(connectionManager: YoizenclawTenantConnectionManager) {
    super(connectionManager as never);
  }

  public async resolveDb(tenantId: string): Promise<Db> {
    return this.getDb(tenantId);
  }
}

describe("TenantScopedRepository", () => {
  let connectionManager: YoizenclawTenantConnectionManager;
  let ensureSchema: ReturnType<typeof mock>;
  let repo: TestTenantRepository;

  beforeEach(() => {
    ensureSchema = mock(async () => ({}) as Db);
    connectionManager = {
      ensureSchema,
    } as unknown as YoizenclawTenantConnectionManager;
    repo = new TestTenantRepository(connectionManager);
  });

  it("calls ensureSchema for a tenant", async () => {
    const tenantId = "tenant-a";
    const db = await repo.resolveDb(tenantId);

    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith(tenantId);
    expect(db).toEqual({});
  });
});
