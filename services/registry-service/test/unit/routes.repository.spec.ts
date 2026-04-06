import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import { RoutesRepository } from "../../src/modules/routes/routes.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

describe("RoutesRepository", () => {
  let repo: RoutesRepository;
  let sqlQueue: unknown[][];

  beforeEach(async () => {
    sqlQueue = [];
    const sql = createQueuedSql(sqlQueue, mock);
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutesRepository,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();
    repo = moduleRef.get(RoutesRepository);
  });

  it("findServiceByTenant returns queued rows", async () => {
    sqlQueue.push([{ id: "svc-1" }]);
    const rows = await repo.findServiceByTenant("svc-1", "t1");
    expect(rows[0]).toEqual({ id: "svc-1" });
  });

  it("listRoutesForService returns routes", async () => {
    sqlQueue.push([{ id: "r1", path_prefix: "/api" }]);
    const rows = await repo.listRoutesForService("svc-1");
    expect(rows[0]).toMatchObject({ path_prefix: "/api" });
  });

  it("insertRoute returns inserted row", async () => {
    sqlQueue.push([{ id: "route-1", path_prefix: "/v1" }]);
    const rows = await repo.insertRoute({
      id: "route-1",
      serviceId: "svc-1",
      dto: { pathPrefix: "/v1" },
      methods: ["GET"],
      isPublic: true,
      stripPrefix: false,
    });
    expect(rows[0]?.path_prefix).toBe("/v1");
  });

  it("deleteRoute completes", async () => {
    sqlQueue.push([]);
    await expect(repo.deleteRoute("route-1", "svc-1")).resolves.toBeDefined();
  });

  it("discoverActiveRoutes returns joined rows", async () => {
    sqlQueue.push([
      {
        id: "r1",
        tenant_id: "t1",
        service_name: "s",
        knative_name: "k",
        namespace: "ns",
        port: 8080,
        path_prefix: "/p",
        methods: ["GET"],
        is_public: true,
        strip_prefix: false,
      },
    ]);
    const rows = await repo.discoverActiveRoutes();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe("t1");
  });
});
