import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { RoutesMongoRepository } from "../../src/modules/routes/routes.mongo.repository";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { makeRegistryMongoClient } from "../mongo-mock";

describe("RoutesMongoRepository", () => {
  let repo: RoutesMongoRepository;
  let queue: unknown[];

  beforeEach(async () => {
    queue = [];
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutesMongoRepository,
        { provide: MONGO_CLIENT, useValue: makeRegistryMongoClient(queue) },
      ],
    }).compile();
    repo = moduleRef.get(RoutesMongoRepository);
  });

  it("findServiceByTenant returns queued rows", async () => {
    queue.push({ _id: "svc-1" });
    const rows = await repo.findServiceByTenant("svc-1", "t1");
    expect(rows[0]).toEqual({ id: "svc-1" });
  });

  it("listRoutesForService returns routes", async () => {
    queue.push([{ _id: "r1", path_prefix: "/api" }]);
    const rows = await repo.listRoutesForService("svc-1");
    expect(rows[0]).toMatchObject({ path_prefix: "/api" });
  });

  it("insertRoute returns inserted row", async () => {
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
    queue.push(1);
    await expect(repo.deleteRoute("route-1", "svc-1")).resolves.toBeDefined();
  });

  it("discoverActiveRoutes returns joined rows", async () => {
    queue.push([
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
