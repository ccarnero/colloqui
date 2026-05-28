import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { createMockMongoClient } from "@yoizen/testing";
import { ClientsMongoRepository } from "../../src/modules/clients/clients.mongo.repository";
import { CLIENTS_REPOSITORY } from "../../src/modules/clients/clients.repository.interface";
import { ClientsService } from "../../src/modules/clients/clients.service";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";

describe("ClientsService", () => {
  let service: ClientsService;
  let findQueue: unknown[];
  let updateQueue: unknown[];

  beforeEach(async () => {
    findQueue = [];
    updateQueue = [];

    const mongoClient = createMockMongoClient(
      new Map([
        [
          "api_clients",
          (operation) => {
            if (operation === "insertOne") {
              return { acknowledged: true };
            }
            if (operation === "find") {
              return findQueue.shift() ?? [];
            }
            if (operation === "updateOne") {
              return { matchedCount: updateQueue.shift() === undefined ? 0 : 1 };
            }
            return null;
          },
        ],
      ]),
      mock,
    );

    const module = await Test.createTestingModule({
      providers: [
        ClientsMongoRepository,
        { provide: CLIENTS_REPOSITORY, useExisting: ClientsMongoRepository },
        ClientsService,
        { provide: MONGO_CLIENT, useValue: mongoClient },
      ],
    }).compile();

    service = module.get(ClientsService);
  });

  describe("create", () => {
    it("should create a client with yoizen_ prefix ID and ysk_ prefix secret", async () => {
      const result = await service.create("test-client", "platform");
      expect(result.client_id).toBeDefined();
      expect(result.client_secret).toBeDefined();
      expect(result.name).toBe("test-client");
    });
  });

  describe("list", () => {
    it("should return all active clients when no tenantId", async () => {
      findQueue.push([
        {
          _id: "c1",
          client_id: "yoizen_abc",
          name: "a",
          scope: "platform",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await service.list();
      expect(result).toHaveLength(1);
    });

    it("should filter by tenant scope when tenantId provided", async () => {
      findQueue.push([
        {
          _id: "c1",
          client_id: "yoizen_abc",
          name: "a",
          scope: "tenant:demo",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await service.list("demo");
      expect(result).toHaveLength(1);
    });
  });

  describe("revoke", () => {
    it("should throw NotFoundException if client not found or already revoked", async () => {
      updateQueue.push(undefined);
      await expect(service.revoke("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should revoke an active client", async () => {
      updateQueue.push(1);
      await expect(service.revoke("c1")).resolves.toBeUndefined();
    });
  });
});
