import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { TENANT_USERS_REPOSITORY } from "../../src/modules/tenant-users/tenant-users.repository.interface";
import { TenantUsersService } from "../../src/modules/tenant-users/tenant-users.service";
import { TenantRolesService } from "../../src/modules/tenant-roles/tenant-roles.service";

describe("TenantUsersService", () => {
  let service: TenantUsersService;
  let repository: {
    findByTenantAndEmail: ReturnType<typeof mock>;
    insertUser: ReturnType<typeof mock>;
    selectRoleName: ReturnType<typeof mock>;
    listByTenant: ReturnType<typeof mock>;
    findActiveById: ReturnType<typeof mock>;
    findByIdAny: ReturnType<typeof mock>;
    updateUser: ReturnType<typeof mock>;
    findId: ReturnType<typeof mock>;
    deactivate: ReturnType<typeof mock>;
    resolveRoleById: ReturnType<typeof mock>;
    resolveRoleByName: ReturnType<typeof mock>;
  };
  const mockTenantRolesService = {
    seedSystemRole: mock(() => Promise.resolve("system-role-id")),
  };

  beforeEach(async () => {
    delete process.env.TENANT_ADMIN_TENANT_ID;
    delete process.env.TENANT_ADMIN_EMAIL;
    delete process.env.TENANT_ADMIN_PASSWORD;

    repository = {
      findByTenantAndEmail: mock(() => Promise.resolve([])),
      insertUser: mock(() => Promise.resolve([])),
      selectRoleName: mock(() => Promise.resolve([])),
      listByTenant: mock(() => Promise.resolve([])),
      findActiveById: mock(() => Promise.resolve([])),
      findByIdAny: mock(() => Promise.resolve([])),
      updateUser: mock(() => Promise.resolve()),
      findId: mock(() => Promise.resolve([])),
      deactivate: mock(() => Promise.resolve()),
      resolveRoleById: mock(() => Promise.resolve([])),
      resolveRoleByName: mock(() => Promise.resolve([])),
    };

    mockTenantRolesService.seedSystemRole.mockReset();
    mockTenantRolesService.seedSystemRole.mockResolvedValue("system-role-id");

    const module = await Test.createTestingModule({
      providers: [
        TenantUsersService,
        { provide: TENANT_USERS_REPOSITORY, useValue: repository },
        { provide: TenantRolesService, useValue: mockTenantRolesService },
      ],
    }).compile();

    service = module.get(TenantUsersService);
  });

  describe("create", () => {
    it("should throw ConflictException if email already exists for tenant", async () => {
      repository.resolveRoleById.mockResolvedValueOnce([{ id: "role-1" }]);
      repository.findByTenantAndEmail.mockResolvedValueOnce([{ id: "existing" }]);
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
      repository.resolveRoleById.mockResolvedValueOnce([]);
      repository.resolveRoleByName.mockResolvedValueOnce([]);
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

      repository.resolveRoleById.mockResolvedValueOnce([{ id: "role-1" }]);
      repository.findByTenantAndEmail.mockResolvedValueOnce([]);
      repository.insertUser.mockResolvedValueOnce([insertedRow]);
      repository.selectRoleName.mockResolvedValueOnce([{ name: "editor" }]);

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
      repository.findActiveById.mockResolvedValueOnce([]);
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
      repository.findActiveById.mockResolvedValueOnce([row]);
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
      repository.listByTenant.mockResolvedValueOnce(rows);
      const result = await service.listByTenant("t1");
      expect(result).toHaveLength(1);
      expect(result[0].tenant_id).toBe("t1");
    });
  });

  describe("update", () => {
    it("should throw NotFoundException if user not found", async () => {
      repository.findByIdAny.mockResolvedValueOnce([]);
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

      repository.findByIdAny.mockResolvedValueOnce([{ id: "u1" }]);
      repository.resolveRoleById.mockResolvedValueOnce([{ id: "r2" }]);
      repository.updateUser.mockResolvedValueOnce(undefined);
      repository.findActiveById.mockResolvedValueOnce([updatedRow]);

      const result = await service.update("t1", "u1", { role_id: "r2" });
      expect(result.role).toBe("admin");
      expect(result.role_id).toBe("r2");
    });
  });

  describe("deactivate", () => {
    it("should throw NotFoundException if user not found", async () => {
      repository.findId.mockResolvedValueOnce([]);
      await expect(
        service.deactivate("t1", "nonexistent"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should deactivate an existing user", async () => {
      repository.findId.mockResolvedValueOnce([{ id: "u1" }]);
      await expect(service.deactivate("t1", "u1")).resolves.toBeUndefined();
      expect(repository.deactivate).toHaveBeenCalledWith("t1", "u1");
    });
  });
});
