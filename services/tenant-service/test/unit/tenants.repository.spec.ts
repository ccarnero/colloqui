import "../setup-env";
import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockMongoClient } from "@yoizen/testing";
import { ProvisioningStatus, TenantDatabaseTier } from "@yoizen/shared";
import { TenantsMongoRepository } from "../../src/modules/tenants/tenants.mongo.repository";
import { TENANTS_REPOSITORY } from "../../src/modules/tenants/tenants.repository.interface";
import { MONGO_CLIENT } from "../../src/providers/platform-mongo.provider";

const rowTemplate = {
  configuration: {} as Record<string, unknown>,
  tier: TenantDatabaseTier.Shared,
  provisioning_status: ProvisioningStatus.Pending,
  provisioning_error: null as string | null,
  provisioning_started_at: null as Date | null,
  provisioning_completed_at: null as Date | null,
};

describe("TenantsMongoRepository", () => {
  it("creates and loads tenants via Mongo adapter", async () => {
    const collections = new Map([
      [
        "tenants",
        (operation: string, args: readonly unknown[]) => {
          if (operation === "insertOne") {
            return { acknowledged: true };
          }
          if (operation === "findOne") {
            return {
              _id: "id-1",
              name: "tenant-a",
              ...rowTemplate,
              created_at: new Date(),
              updated_at: new Date(),
            };
          }
          return null;
        },
      ],
    ]);
    const client = createMockMongoClient(collections, mock);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsMongoRepository,
        { provide: TENANTS_REPOSITORY, useExisting: TenantsMongoRepository },
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();

    const repository = moduleRef.get(TenantsMongoRepository);
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
      _id: "i1",
      name: "n1",
      ...rowTemplate,
      configuration: {},
      created_at: new Date(),
      updated_at: new Date(),
    };
    const collections = new Map([
      [
        "tenants",
        (operation: string) => {
          if (operation === "find") {
            return [row];
          }
          return null;
        },
      ],
    ]);
    const client = createMockMongoClient(collections, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsMongoRepository,
        { provide: TENANTS_REPOSITORY, useExisting: TenantsMongoRepository },
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();
    const repository = moduleRef.get(TenantsMongoRepository);
    const all = await repository.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("n1");
  });

  it("updateConfiguration returns updated row", async () => {
    const row = {
      _id: "i1",
      name: "n1",
      ...rowTemplate,
      configuration: { k: "v" },
      created_at: new Date(),
      updated_at: new Date(),
    };
    const client = {
      db: () => ({
        collection: () => ({
          findOneAndUpdate: mock(() => Promise.resolve(row)),
        }),
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsMongoRepository,
        { provide: TENANTS_REPOSITORY, useExisting: TenantsMongoRepository },
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();
    const repository = moduleRef.get(TenantsMongoRepository);
    const updated = await repository.updateConfiguration("n1", { k: "v" });
    expect(updated?.configuration).toEqual({ k: "v" });
  });

  it("deleteByName returns boolean from delete count", async () => {
    const collections = new Map([
      [
        "tenants",
        (operation: string) => {
          if (operation === "deleteOne") {
            return { deletedCount: 1 };
          }
          return null;
        },
      ],
    ]);
    const client = createMockMongoClient(collections, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsMongoRepository,
        { provide: TENANTS_REPOSITORY, useExisting: TenantsMongoRepository },
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();
    const repository = moduleRef.get(TenantsMongoRepository);
    const ok = await repository.deleteByName("gone");
    expect(ok).toBe(true);
  });
});
