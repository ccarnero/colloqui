import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Sql } from "@yoizen/database";
import { TenantConnectionManager } from "@yoizen/database";
import { TenantScopedRepository } from "../../src/providers/tenant-scoped.repository";

/**
 * Concrete subclass to exercise protected `getSql` (schema ensure + connection).
 */
class TestTenantRepository extends TenantScopedRepository {
  public constructor(connectionManager: TenantConnectionManager) {
    super(connectionManager);
  }

  public async resolveSql(tenantId: string): Promise<Sql> {
    return this.getSql(tenantId);
  }
}

describe("TenantScopedRepository", () => {
  let connectionManager: TenantConnectionManager;
  let ensureSchema: ReturnType<typeof mock>;
  let getConnection: ReturnType<typeof mock>;
  let repo: TestTenantRepository;

  beforeEach(() => {
    ensureSchema = mock(() => Promise.resolve());
    getConnection = mock(() => Promise.resolve({} as Sql));
    connectionManager = {
      ensureSchema,
      getConnection,
    } as unknown as TenantConnectionManager;
    repo = new TestTenantRepository(connectionManager);
  });

  it("should call ensureSchema then getConnection for a tenant", async () => {
    const tenantId = "tenant-a";
    const sql = await repo.resolveSql(tenantId);

    expect(ensureSchema).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith(tenantId);
    expect(getConnection).toHaveBeenCalledTimes(1);
    expect(getConnection).toHaveBeenCalledWith(tenantId);
    expect(sql).toEqual({});
  });

  it("should await ensureSchema before getConnection", async () => {
    const order: string[] = [];
    ensureSchema = mock(async () => {
      order.push("ensure");
    });
    getConnection = mock(async () => {
      order.push("get");
      return {} as Sql;
    });
    connectionManager = {
      ensureSchema,
      getConnection,
    } as unknown as TenantConnectionManager;
    repo = new TestTenantRepository(connectionManager);

    await repo.resolveSql("t1");

    expect(order).toEqual(["ensure", "get"]);
  });
});
