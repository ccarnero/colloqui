import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ServicesMongoRepository } from "../../src/modules/services/services.mongo.repository";
import type { RegisterServiceDto } from "../../src/modules/services/services.dto";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";

type CollectionMock = {
  findOne: ReturnType<typeof mock>;
  find: ReturnType<typeof mock>;
  insertOne: ReturnType<typeof mock>;
  findOneAndUpdate: ReturnType<typeof mock>;
  deleteOne: ReturnType<typeof mock>;
  deleteMany: ReturnType<typeof mock>;
};

function makeCollectionMock(queue: unknown[][]): CollectionMock {
  const shift = (): unknown =>
    queue.length > 0 ? queue.shift() : undefined;
  return {
    findOne: mock(async () => shift()),
    insertOne: mock(async () => ({ acknowledged: true })),
    findOneAndUpdate: mock(async () => shift()),
    deleteOne: mock(async () => ({ deletedCount: 1 })),
    deleteMany: mock(async () => ({ deletedCount: 0 })),
    find: mock(() => ({
      sort: mock(() => ({
        toArray: mock(async () => (shift() as unknown[]) ?? []),
      })),
    })),
  };
}

describe("ServicesMongoRepository", () => {
  let repo: ServicesMongoRepository;
  let queue: unknown[];
  let collections: Map<string, CollectionMock>;

  beforeEach(async () => {
    queue = [];
    collections = new Map();
    const client = {
      db: mock(() => ({
        collection: mock((name: string) => {
          let col = collections.get(name);
          if (!col) {
            col = makeCollectionMock(queue);
            collections.set(name, col);
          }
          return col;
        }),
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesMongoRepository,
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();
    repo = moduleRef.get(ServicesMongoRepository);
  });

  it("findIdByTenantAndName dequeues a row batch", async () => {
    queue.push({ _id: "svc-1" });
    const rows = await repo.findIdByTenantAndName("t1", "name");
    expect(rows).toEqual([{ id: "svc-1" }]);
  });

  it("listByTenant returns queued rows", async () => {
    queue.push([{ _id: "a" }, { _id: "b" }]);
    const rows = await repo.listByTenant("t1");
    expect(rows).toHaveLength(2);
  });

  it("deleteById runs without throwing", async () => {
    await expect(repo.deleteById("id-1")).resolves.toBeUndefined();
  });

  it("insertRegisteredService returns queued row", async () => {
    const rows = await repo.insertRegisteredService({
      id: "new-svc",
      tenantId: "t1",
      dto: { name: "api", image: "img:v1" } as RegisterServiceDto,
      port: 8080,
      minScale: 0,
      maxScale: 3,
      concurrencyTarget: 10,
      envVars: {},
      ksvcName: "ksvc-api",
      ns: "ns-1",
    });
    expect(rows[0]?._id).toBe("new-svc");
  });

  it("findByIdAndTenant returns queued row", async () => {
    queue.push({ _id: "svc-1", tenant_id: "t1" });
    const rows = await repo.findByIdAndTenant("svc-1", "t1");
    expect(rows[0]?._id).toBe("svc-1");
  });

  it("updateRegisteredService returns queued row", async () => {
    queue.push({ _id: "svc-1", image: "img:v2" });
    const rows = await repo.updateRegisteredService({
      id: "svc-1",
      tenantId: "t1",
      image: "img:v2",
      port: 8080,
      minScale: 0,
      maxScale: 3,
      concurrencyTarget: 10,
      envVars: {},
    });
    expect(rows[0]?.image).toBe("img:v2");
  });

  it("selectKnativeMetaForRevision returns queued row", async () => {
    queue.push({ knative_name: "k", namespace: "ns" });
    const rows = await repo.selectKnativeMetaForRevision("svc-1", "t1");
    expect(rows[0]).toMatchObject({ knative_name: "k", namespace: "ns" });
  });
});
