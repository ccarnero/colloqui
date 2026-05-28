import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { CanaryMongoRepository } from "../../src/modules/canary/canary.mongo.repository";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";

type CollectionMock = {
  findOne: ReturnType<typeof mock>;
  insertOne: ReturnType<typeof mock>;
  findOneAndUpdate: ReturnType<typeof mock>;
  find: ReturnType<typeof mock>;
};

function makeCollectionMock(queue: unknown[][]): CollectionMock {
  const shift = (): unknown =>
    queue.length > 0 ? queue.shift() : undefined;
  return {
    findOne: mock(async () => shift()),
    insertOne: mock(async () => ({ acknowledged: true })),
    findOneAndUpdate: mock(async () => shift()),
    find: mock(() => ({
      sort: mock(() => ({
        limit: mock(() => ({
          next: mock(async () => shift()),
        })),
      })),
    })),
  };
}

describe("CanaryMongoRepository", () => {
  let repo: CanaryMongoRepository;
  let queue: unknown[][];

  beforeEach(async () => {
    queue = [];
    const collections = new Map<string, CollectionMock>();
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
        CanaryMongoRepository,
        { provide: MONGO_CLIENT, useValue: client },
      ],
    }).compile();
    repo = moduleRef.get(CanaryMongoRepository);
  });

  it("findProgressingCanary returns rows", async () => {
    queue.push({ _id: "can-1" });
    const rows = await repo.findProgressingCanary("svc-1");
    expect(rows[0]).toEqual({ id: "can-1" });
  });

  it("insertCanaryDeployment returns inserted row", async () => {
    const rows = await repo.insertCanaryDeployment({
      id: "c1",
      serviceId: "svc-1",
      stableRevision: "r1",
      canaryRevision: "r2",
      percent: 10,
    });
    expect(rows[0]).toMatchObject({ canary_percent: 10, status: "progressing" });
  });

  it("getLatestCanaryForService returns latest", async () => {
    queue.push({ _id: "latest", status: "progressing" });
    const rows = await repo.getLatestCanaryForService("svc-1");
    expect(rows[0]?._id).toBe("latest");
  });

  it("findActiveCanary returns progressing canary", async () => {
    queue.push({ _id: "act-1" });
    const rows = await repo.findActiveCanary("svc-1");
    expect(rows).toHaveLength(1);
  });

  it("updateCanaryPercent updates percent", async () => {
    queue.push({ _id: "c1", canary_percent: 25 });
    const rows = await repo.updateCanaryPercent("c1", { percent: 25 });
    expect(rows[0]?.canary_percent).toBe(25);
  });

  it("updateCanaryPromoted sets status", async () => {
    queue.push({ _id: "c1", status: "promoted" });
    const rows = await repo.updateCanaryPromoted("c1");
    expect(rows[0]?.status).toBe("promoted");
  });

  it("updateCanaryRolledBack sets status", async () => {
    queue.push({ _id: "c1", status: "rolled_back" });
    const rows = await repo.updateCanaryRolledBack("c1");
    expect(rows[0]?.status).toBe("rolled_back");
  });

  it("findRegisteredService scopes by tenant", async () => {
    queue.push({ _id: "svc-1", tenant_id: "t1" });
    const rows = await repo.findRegisteredService("svc-1", "t1");
    expect(rows[0]?.tenant_id).toBe("t1");
  });
});
