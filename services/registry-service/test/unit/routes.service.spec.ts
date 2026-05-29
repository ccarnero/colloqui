import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { RoutesMongoRepository } from "../../src/modules/routes/routes.mongo.repository";
import { ROUTES_REPOSITORY } from "../../src/modules/routes/routes.repository.interface";
import { RoutesService } from "../../src/modules/routes/routes.service";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { makeRegistryMongoClient } from "../mongo-mock";

describe("RoutesService", () => {
  let service: RoutesService;
  let queue: unknown[];

  beforeEach(async () => {
    queue = [];
    const mongo = makeRegistryMongoClient(queue);
    const module = await Test.createTestingModule({
      providers: [
        RoutesMongoRepository,
        {
          provide: ROUTES_REPOSITORY,
          useExisting: RoutesMongoRepository,
        },
        RoutesService,
        { provide: MONGO_CLIENT, useValue: mongo },
      ],
    }).compile();
    service = module.get(RoutesService);
  });

  describe("create", () => {
    it("creates route when service exists", async () => {
      queue.push({ _id: "svc-1" });
      const route = await service.create("tenant-a", "svc-1", {
        pathPrefix: "/api",
        methods: ["GET"],
        isPublic: true,
        stripPrefix: true,
      });
      expect(route.pathPrefix).toBe("/api");
    });

    it("throws NotFoundException when service missing", async () => {
      queue.push(null);
      await expect(
        service.create("tenant-a", "missing", {
          pathPrefix: "/api",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException on duplicate path", async () => {
      queue.push({ _id: "svc-1" });
      const err = Object.assign(new Error("dup"), { code: 11000 });
      queue.push(Object.assign(new Error("dup"), { code: 11000 }));
      await expect(
        service.create("tenant-a", "svc-1", { pathPrefix: "/dup" }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("listForService", () => {
    it("returns mapped routes", async () => {
      queue.push({ _id: "svc-1" });
      queue.push([
        {
          _id: "r1",
          service_id: "svc-1",
          path_prefix: "/v1",
          methods: ["GET"],
          is_public: false,
          strip_prefix: true,
          created_at: new Date(),
        },
      ]);
      const routes = await service.listForService("tenant-a", "svc-1");
      expect(routes).toHaveLength(1);
      expect(routes[0]?.pathPrefix).toBe("/v1");
    });
  });

  describe("remove", () => {
    it("deletes route", async () => {
      queue.push(1);
      await expect(
        service.remove("tenant-a", "svc-1", "route-1"),
      ).resolves.toBeUndefined();
    });

    it("throws NotFoundException when route missing", async () => {
      queue.push(0);
      await expect(
        service.remove("tenant-a", "svc-1", "route-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("discover", () => {
    it("returns cached discovery payload", async () => {
      queue.push([
        {
          id: "r1",
          tenant_id: "t1",
          service_name: "svc",
          knative_name: "k",
          namespace: "ns",
          port: 8080,
          path_prefix: "/p",
          methods: ["GET"],
          is_public: true,
          strip_prefix: false,
        },
      ]);
      const first = await service.discover();
      const second = await service.discover();
      expect(first).toHaveLength(1);
      expect(second).toEqual(first);
    });
  });
});
