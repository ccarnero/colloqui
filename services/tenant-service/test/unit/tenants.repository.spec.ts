import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import type { Sql } from "postgres";
import { ProvisioningStatus, TenantDatabaseTier } from "@yoizen/shared";
import { TenantsRepository } from "../../src/modules/tenants/tenants.repository";
import { PLATFORM_POSTGRES_SQL } from "../../src/providers/platform-postgres.provider";

const rowTemplate = {
  configuration: {} as Record<string, unknown>,
  tier: TenantDatabaseTier.Shared,
  provisioning_status: ProvisioningStatus.Pending,
  provisioning_error: null as string | null,
  provisioning_started_at: null as Date | null,
  provisioning_completed_at: null as Date | null,
};

describe("TenantsRepository", () => {
  it("creates and loads tenants via SQL adapter", async () => {
    const sql = Object.assign(
      mock(() =>
        Promise.resolve([
          {
            id: "id-1",
            name: "tenant-a",
            ...rowTemplate,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]),
      ),
      {
        json: (value: unknown) => value,
      },
    ) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsRepository,
        { provide: PLATFORM_POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    const repository = moduleRef.get(TenantsRepository);
    const created = await repository.create(
      "id-1",
      "tenant-a",
      TenantDatabaseTier.Shared,
      {},
    );
    const byName = await repository.findByName("tenant-a");

    expect(created.name).toBe("tenant-a");
    expect(byName?.name).toBe("tenant-a");
  });

  it("findAll returns all tenant rows", async () => {
    const row = {
      id: "i1",
      name: "n1",
      ...rowTemplate,
      configuration: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
    const sqlQueue: unknown[][] = [[row]];
    const sql = createQueuedSql(sqlQueue, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsRepository,
        { provide: PLATFORM_POSTGRES_SQL, useValue: sql },
      ],
    }).compile();
    const repository = moduleRef.get(TenantsRepository);
    const all = await repository.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("n1");
  });

  it("updateConfiguration returns updated row", async () => {
    const row = {
      id: "i1",
      name: "n1",
      ...rowTemplate,
      configuration: { k: "v" },
      created_at: new Date(),
      updated_at: new Date(),
    };
    const sqlQueue: unknown[][] = [[row]];
    const sql = createQueuedSql(sqlQueue, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsRepository,
        { provide: PLATFORM_POSTGRES_SQL, useValue: sql },
      ],
    }).compile();
    const repository = moduleRef.get(TenantsRepository);
    const updated = await repository.updateConfiguration("n1", { k: "v" });
    expect(updated?.configuration).toEqual({ k: "v" });
  });

  it("deleteByName returns boolean from delete count", async () => {
    const sql = Object.assign(
      mock(() => Promise.resolve({ count: 1 })),
      { json: (value: unknown) => value },
    ) as unknown as Sql;
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsRepository,
        { provide: PLATFORM_POSTGRES_SQL, useValue: sql },
      ],
    }).compile();
    const repository = moduleRef.get(TenantsRepository);
    const ok = await repository.deleteByName("gone");
    expect(ok).toBe(true);
  });
});
