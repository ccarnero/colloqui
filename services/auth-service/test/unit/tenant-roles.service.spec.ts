import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { TENANT_ROLES_REPOSITORY } from "../../src/modules/tenant-roles/tenant-roles.repository.interface";
import { TenantRolesService } from "../../src/modules/tenant-roles/tenant-roles.service";

describe("TenantRolesService", () => {
  let service: TenantRolesService;
  let repository: {
    findSystemRoleId: ReturnType<typeof mock>;
    insertSystemRoleOnConflict: ReturnType<typeof mock>;
    findRoleByTenantAndName: ReturnType<typeof mock>;
    createRoleWithPermissions: ReturnType<typeof mock>;
    listSummariesByTenant: ReturnType<typeof mock>;
    findActiveRoleBase: ReturnType<typeof mock>;
    listPermissionsForRole: ReturnType<typeof mock>;
    findRoleForUpdate: ReturnType<typeof mock>;
    findDuplicateName: ReturnType<typeof mock>;
    updateRoleTransaction: ReturnType<typeof mock>;
    findForDelete: ReturnType<typeof mock>;
    hasActiveUsersForRole: ReturnType<typeof mock>;
    softDeleteRole: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    repository = {
      findSystemRoleId: mock(() => Promise.resolve([])),
      insertSystemRoleOnConflict: mock(() => Promise.resolve()),
      findRoleByTenantAndName: mock(() => Promise.resolve([])),
      createRoleWithPermissions: mock(() => Promise.resolve()),
      listSummariesByTenant: mock(() => Promise.resolve([])),
      findActiveRoleBase: mock(() => Promise.resolve([])),
      listPermissionsForRole: mock(() => Promise.resolve([])),
      findRoleForUpdate: mock(() => Promise.resolve([])),
      findDuplicateName: mock(() => Promise.resolve([])),
      updateRoleTransaction: mock(() => Promise.resolve()),
      findForDelete: mock(() => Promise.resolve([])),
      hasActiveUsersForRole: mock(() => Promise.resolve(false)),
      softDeleteRole: mock(() => Promise.resolve()),
    };

    const module = await Test.createTestingModule({
      providers: [
        TenantRolesService,
        { provide: TENANT_ROLES_REPOSITORY, useValue: repository },
      ],
    }).compile();

    service = module.get(TenantRolesService);
  });

  describe("seedSystemRole", () => {
    it("should return existing system role ID if present", async () => {
      repository.findSystemRoleId.mockResolvedValueOnce([{ id: "role-1" }]);
      const id = await service.seedSystemRole("t1");
      expect(id).toBe("role-1");
    });

    it("should create and return new system role ID if absent", async () => {
      repository.findSystemRoleId.mockResolvedValueOnce([]);
      const id = await service.seedSystemRole("t1");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
      expect(repository.insertSystemRoleOnConflict).toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("should throw ConflictException for reserved name tenant_admin", async () => {
      await expect(
        service.create({
          tenantId: "t1",
          name: "tenant_admin",
          description: undefined,
          permissions: [],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("should throw ConflictException if role name already exists", async () => {
      repository.findRoleByTenantAndName.mockResolvedValueOnce([
        { id: "existing" },
      ]);
      await expect(
        service.create({
          tenantId: "t1",
          name: "editor",
          description: undefined,
          permissions: [],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("listByTenant", () => {
    it("should return roles with user counts", async () => {
      const rows = [
        {
          id: "r1",
          name: "admin",
          description: null,
          is_system: true,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
          user_count: 2,
        },
      ];
      repository.listSummariesByTenant.mockResolvedValueOnce(rows);
      const result = await service.listByTenant("t1");
      expect(result).toHaveLength(1);
      expect(result[0].user_count).toBe(2);
      expect(result[0].tenant_id).toBe("t1");
    });
  });

  describe("getWithPermissions", () => {
    it("should throw NotFoundException if role not found", async () => {
      repository.findActiveRoleBase.mockResolvedValueOnce([]);
      await expect(
        service.getWithPermissions("t1", "nonexistent"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should return role with permissions", async () => {
      const role = {
        id: "r1",
        name: "editor",
        description: null,
        is_system: false,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      repository.findActiveRoleBase.mockResolvedValueOnce([role]);
      repository.listPermissionsForRole.mockResolvedValueOnce([
        { resource: "agents", action: "read" },
      ]);
      const result = await service.getWithPermissions("t1", "r1");
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0].resource).toBe("agents");
      expect(result.tenant_id).toBe("t1");
    });
  });

  describe("delete", () => {
    it("should throw NotFoundException if role not found", async () => {
      repository.findForDelete.mockResolvedValueOnce([]);
      await expect(service.delete("t1", "nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException for system role", async () => {
      repository.findForDelete.mockResolvedValueOnce([
        { id: "r1", is_system: true },
      ]);
      await expect(service.delete("t1", "r1")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("should throw BadRequestException if role has active users", async () => {
      repository.findForDelete.mockResolvedValueOnce([
        { id: "r1", is_system: false },
      ]);
      repository.hasActiveUsersForRole.mockResolvedValueOnce(true);
      await expect(service.delete("t1", "r1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("should soft-delete a role with no users", async () => {
      repository.findForDelete.mockResolvedValueOnce([
        { id: "r1", is_system: false },
      ]);
      repository.hasActiveUsersForRole.mockResolvedValueOnce(false);
      await expect(service.delete("t1", "r1")).resolves.toBeUndefined();
      expect(repository.softDeleteRole).toHaveBeenCalledWith("t1", "r1");
    });
  });

  describe("update", () => {
    it("throws NotFoundException when role missing", async () => {
      repository.findRoleForUpdate.mockResolvedValueOnce([]);
      await expect(
        service.update("t1", "missing", { name: "x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws ForbiddenException when renaming system role", async () => {
      repository.findRoleForUpdate.mockResolvedValueOnce([
        {
          id: "r1",
          name: "tenant_admin",
          is_system: true,
        },
      ]);
      await expect(
        service.update("t1", "r1", { name: "other" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("throws ConflictException for duplicate name", async () => {
      repository.findRoleForUpdate.mockResolvedValueOnce([
        {
          id: "r1",
          name: "editor",
          is_system: false,
        },
      ]);
      repository.findDuplicateName.mockResolvedValueOnce([{ id: "other" }]);
      await expect(
        service.update("t1", "r1", { name: "taken" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
