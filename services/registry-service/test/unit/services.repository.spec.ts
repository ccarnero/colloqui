import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import { ServicesRepository } from "../../src/modules/services/services.repository";
import type { RegisterServiceDto } from "../../src/modules/services/services.dto";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

describe("ServicesRepository", () => {
  let repo: ServicesRepository;
  let sqlQueue: unknown[][];

  beforeEach(async () => {
    process.env.PLATFORM_ENVIRONMENT = "dev";
    sqlQueue = [];
    const sql = createQueuedSql(sqlQueue, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();
    repo = moduleRef.get(ServicesRepository);
  });

  it("findIdByTenantAndName dequeues a row batch", async () => {
    sqlQueue.push([{ id: "svc-1" }]);
    const rows = await repo.findIdByTenantAndName("t1", "name");
    expect(rows).toEqual([{ id: "svc-1" }]);
  });

  it("listByTenant returns queued rows", async () => {
    sqlQueue.push([{ id: "a" }, { id: "b" }]);
    const rows = await repo.listByTenant("t1");
    expect(rows).toHaveLength(2);
  });

  it("deleteById runs without throwing", async () => {
    sqlQueue.push([]);
    await expect(repo.deleteById("id-1")).resolves.toBeUndefined();
  });

  it("insertRegisteredService returns queued row", async () => {
    sqlQueue.push([{ id: "new-svc" }]);
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
    expect(rows[0]).toEqual({ id: "new-svc" });
  });

  it("findByIdAndTenant returns queued row", async () => {
    sqlQueue.push([{ id: "svc-1", tenant_id: "t1" }]);
    const rows = await repo.findByIdAndTenant("svc-1", "t1");
    expect(rows[0]?.id).toBe("svc-1");
  });

  it("updateRegisteredService returns queued row", async () => {
    sqlQueue.push([{ id: "svc-1", image: "img:v2" }]);
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
    sqlQueue.push([{ knative_name: "k", namespace: "ns" }]);
    const rows = await repo.selectKnativeMetaForRevision("svc-1", "t1");
    expect(rows[0]).toMatchObject({ knative_name: "k", namespace: "ns" });
  });
});
