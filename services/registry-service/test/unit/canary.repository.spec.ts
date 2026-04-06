import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import { CanaryRepository } from "../../src/modules/canary/canary.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

describe("CanaryRepository", () => {
  let repo: CanaryRepository;
  let sqlQueue: unknown[][];

  beforeEach(async () => {
    sqlQueue = [];
    const sql = createQueuedSql(sqlQueue, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CanaryRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();
    repo = moduleRef.get(CanaryRepository);
  });

  it("findProgressingCanary returns rows", async () => {
    sqlQueue.push([{ id: "can-1" }]);
    const rows = await repo.findProgressingCanary("svc-1");
    expect(rows[0]).toEqual({ id: "can-1" });
  });

  it("insertCanaryDeployment returns inserted row", async () => {
    sqlQueue.push([
      {
        id: "c1",
        service_id: "svc-1",
        stable_revision: "r1",
        canary_revision: "r2",
        canary_percent: 10,
        status: "progressing",
      },
    ]);
    const rows = await repo.insertCanaryDeployment({
      id: "c1",
      serviceId: "svc-1",
      stableRevision: "r1",
      canaryRevision: "r2",
      percent: 10,
    });
    expect(rows[0]).toMatchObject({ canary_percent: 10 });
  });

  it("getLatestCanaryForService returns latest", async () => {
    sqlQueue.push([{ id: "latest", status: "progressing" }]);
    const rows = await repo.getLatestCanaryForService("svc-1");
    expect(rows[0]?.id).toBe("latest");
  });

  it("findActiveCanary returns progressing canary", async () => {
    sqlQueue.push([{ id: "act-1" }]);
    const rows = await repo.findActiveCanary("svc-1");
    expect(rows).toHaveLength(1);
  });

  it("updateCanaryPercent updates percent", async () => {
    sqlQueue.push([{ id: "c1", canary_percent: 25 }]);
    const rows = await repo.updateCanaryPercent("c1", { percent: 25 });
    expect(rows[0]?.canary_percent).toBe(25);
  });

  it("updateCanaryPromoted sets status", async () => {
    sqlQueue.push([{ id: "c1", status: "promoted" }]);
    const rows = await repo.updateCanaryPromoted("c1");
    expect(rows[0]?.status).toBe("promoted");
  });

  it("updateCanaryRolledBack sets status", async () => {
    sqlQueue.push([{ id: "c1", status: "rolled_back" }]);
    const rows = await repo.updateCanaryRolledBack("c1");
    expect(rows[0]?.status).toBe("rolled_back");
  });

  it("findRegisteredService scopes by tenant", async () => {
    sqlQueue.push([{ id: "svc-1", tenant_id: "t1" }]);
    const rows = await repo.findRegisteredService("svc-1", "t1");
    expect(rows[0]?.tenant_id).toBe("t1");
  });
});
