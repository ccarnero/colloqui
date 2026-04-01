import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { TenantUsersService } from "../../src/modules/tenant-users/tenant-users.service";
import { TenantRolesService } from "../../src/modules/tenant-roles/tenant-roles.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

function createMockSql() {
  const fn = mock((..._args: unknown[]) => Promise.resolve([]));
  return fn as unknown as ReturnType<typeof import("postgres")>;
}

describe("TenantUsersService", () => {
  let service: TenantUsersService;
  let sql: ReturnType<typeof createMockSql>;
  const mockTenantRolesService = {
    seedSystemRole: mock(() => Promise.resolve("system-role-id")),
  };

  beforeEach(async () => {
    delete process.env.TENANT_ADMIN_TENANT_ID;
    delete process.env.TENANT_ADMIN_EMAIL;
    delete process.env.TENANT_ADMIN_PASSWORD;

    sql = createMockSql();
    mockTenantRolesService.seedSystemRole.mockReset();
    mockTenantRolesService.seedSystemRole.mockResolvedValue("system-role-id");

    const module = await Test.createTestingModule({
      providers: [
        TenantUsersService,
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: TenantRolesService, useValue: mockTenantRolesService },
      ],
    }).compile();

    service = module.get(TenantUsersService);
  });

  describe("create", () => {
    it("should throw ConflictException if email already exists for tenant", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([{ id: "role-1" }]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([{ id: "existing" }]);
      await expect(
        service.create("t1", "dup@test.com", "pass123456", "role-1"),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should throw BadRequestException for invalid role", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.create("t1", "new@test.com", "pass123456", "bad-role"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("findById", () => {
    it("should throw NotFoundException if user not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.findById("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should return user by id", async () => {
      const row = {
        id: "u1",
        tenant_id: "t1",
        email: "user@test.com",
        role_id: "r1",
        role: "editor",
        display_name: "User",
        created_at: new Date(),
        updated_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([row]);
      const result = await service.findById("u1");
      expect(result.email).toBe("user@test.com");
    });
  });

  describe("listByTenant", () => {
    it("should return active users for tenant", async () => {
      const rows = [
        {
          id: "u1",
          tenant_id: "t1",
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
    });
  });

  describe("deactivate", () => {
    it("should throw NotFoundException if user not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.deactivate("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should deactivate an existing user", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([{ id: "u1" }]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.deactivate("u1")).resolves.toBeUndefined();
    });
  });
});
