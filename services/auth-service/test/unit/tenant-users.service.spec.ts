import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { createMockPostgresSql } from "@yoizen/testing";
import { TenantUsersRepository } from "../../src/modules/tenant-users/tenant-users.repository";
import { TenantUsersService } from "../../src/modules/tenant-users/tenant-users.service";
import { TenantRolesService } from "../../src/modules/tenant-roles/tenant-roles.service";
import { AuthTenantConnectionManager } from "../../src/providers/auth-tenant-connection-manager";

describe("TenantUsersService", () => {
  let service: TenantUsersService;
  let sql: ReturnType<typeof createMockPostgresSql>;
  const mockTenantRolesService = {
    seedSystemRole: mock(() => Promise.resolve("system-role-id")),
  };

  beforeEach(async () => {
    delete process.env.TENANT_ADMIN_TENANT_ID;
    delete process.env.TENANT_ADMIN_EMAIL;
    delete process.env.TENANT_ADMIN_PASSWORD;

    sql = createMockPostgresSql(mock);
    const authTcm = {
      ensureSchema: mock(() => Promise.resolve(sql)),
    };
    mockTenantRolesService.seedSystemRole.mockReset();
    mockTenantRolesService.seedSystemRole.mockResolvedValue("system-role-id");

    const module = await Test.createTestingModule({
      providers: [
        TenantUsersRepository,
        TenantUsersService,
        { provide: AuthTenantConnectionManager, useValue: authTcm },
        { provide: TenantRolesService, useValue: mockTenantRolesService },
      ],
    }).compile();

    service = module.get(TenantUsersService);
  });

  describe("create", () => {
    it("should throw ConflictException if email already exists for tenant", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "role-1" },
      ]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "existing" },
      ]);
      await expect(
        service.create({
          tenantId: "t1",
          email: "dup@test.com",
          password: "pass123456",
          roleId: "role-1",
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should throw BadRequestException for invalid role", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.create({
          tenantId: "t1",
          email: "new@test.com",
          password: "pass123456",
          roleId: "bad-role",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("should insert user and return mapped result", async () => {
      const now = new Date();
      const insertedRow = {
        id: "u-new",
        email: "new@test.com",
        role_id: "role-1",
        display_name: "New User",
        created_at: now,
        updated_at: now,
      };

      const sqlMock = sql as unknown as ReturnType<typeof mock>;
      sqlMock.mockResolvedValueOnce([{ id: "role-1" }]);
      sqlMock.mockResolvedValueOnce([]);
      sqlMock.mockResolvedValueOnce([insertedRow]);
      sqlMock.mockResolvedValueOnce([{ name: "editor" }]);

      const result = await service.create({
        tenantId: "t1",
        email: "new@test.com",
        password: "pass123456",
        roleId: "role-1",
        displayName: "New User",
      });
      expect(result.id).toBe("u-new");
      expect(result.email).toBe("new@test.com");
      expect(result.tenant_id).toBe("t1");
      expect(result.role).toBe("editor");
    });
  });

  describe("findById", () => {
    it("should throw NotFoundException if user not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.findById("t1", "nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should return user by id", async () => {
      const row = {
        id: "u1",
        email: "user@test.com",
        role_id: "r1",
        role: "editor",
        display_name: "User",
        created_at: new Date(),
        updated_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([row]);
      const result = await service.findById("t1", "u1");
      expect(result.email).toBe("user@test.com");
      expect(result.tenant_id).toBe("t1");
    });
  });

  describe("listByTenant", () => {
    it("should return active users for tenant", async () => {
      const rows = [
        {
          id: "u1",
          email: "a@test.com",
          role_id: "r1",
          role: "admin",
          display_name: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(rows);
      const result = await service.listByTenant("t1");
      expect(result).toHaveLength(1);
      expect(result[0].tenant_id).toBe("t1");
    });
  });

  describe("update", () => {
    it("should throw NotFoundException if user not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.update("t1", "nonexistent", { role_id: "r2" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should update role and return refreshed user", async () => {
      const now = new Date();
      const updatedRow = {
        id: "u1",
        email: "user@test.com",
        role_id: "r2",
        role: "admin",
        display_name: "User",
        created_at: now,
        updated_at: now,
      };

      const sqlMock = sql as unknown as ReturnType<typeof mock>;
      sqlMock.mockResolvedValueOnce([{ id: "u1" }]);
      sqlMock.mockResolvedValueOnce([{ id: "r2" }]);
      sqlMock.mockResolvedValueOnce([]);
      sqlMock.mockResolvedValueOnce([updatedRow]);

      const result = await service.update("t1", "u1", { role_id: "r2" });
      expect(result.role).toBe("admin");
      expect(result.role_id).toBe("r2");
    });
  });

  describe("deactivate", () => {
    it("should throw NotFoundException if user not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.deactivate("t1", "nonexistent"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should deactivate an existing user", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "u1" },
      ]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.deactivate("t1", "u1")).resolves.toBeUndefined();
    });
  });
});
