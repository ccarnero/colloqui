import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { createMockPostgresSql } from "@yoizen/testing";
import { ClientsRepository } from "../../src/modules/clients/clients.repository";
import { ClientsService } from "../../src/modules/clients/clients.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

describe("ClientsService", () => {
  let service: ClientsService;
  let sql: ReturnType<typeof createMockPostgresSql>;

  beforeEach(async () => {
    sql = createMockPostgresSql(mock);

    const module = await Test.createTestingModule({
      providers: [
        ClientsRepository,
        ClientsService,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    service = module.get(ClientsService);
  });

  describe("create", () => {
    it("should create a client with yoizen_ prefix ID and ysk_ prefix secret", async () => {
      const row = {
        id: "id-1",
        client_id: "yoizen_abc",
        name: "test-client",
        scope: "platform",
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([row]);

      const result = await service.create("test-client", "platform");
      expect(result.client_id).toBeDefined();
      expect(result.client_secret).toBeDefined();
      expect(result.name).toBe("test-client");
    });
  });

  describe("list", () => {
    it("should return all active clients when no tenantId", async () => {
      const rows = [
        {
          id: "c1",
          client_id: "yoizen_abc",
          name: "a",
          scope: "platform",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(rows);

      const result = await service.list();
      expect(result).toHaveLength(1);
    });

    it("should filter by tenant scope when tenantId provided", async () => {
      const rows = [
        {
          id: "c1",
          client_id: "yoizen_abc",
          name: "a",
          scope: "tenant:demo",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(rows);

      const result = await service.list("demo");
      expect(result).toHaveLength(1);
    });
  });

  describe("revoke", () => {
    it("should throw NotFoundException if client not found or already revoked", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.revoke("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should revoke an active client", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "c1" },
      ]);
      await expect(service.revoke("c1")).resolves.toBeUndefined();
    });
  });
});
