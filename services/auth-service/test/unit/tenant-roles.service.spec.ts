import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { TenantRolesRepository } from "../../src/modules/tenant-roles/tenant-roles.repository";
import { TenantRolesService } from "../../src/modules/tenant-roles/tenant-roles.service";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

function createMockSql() {
  const fn = mock((..._args: unknown[]) => Promise.resolve([]));
  (fn as Record<string, unknown>).begin = mock(
    async (cb: (tx: unknown) => Promise<void>) => {
      const tx = mock((..._args: unknown[]) => Promise.resolve([]));
      await cb(tx);
    },
  );
  return fn as unknown as ReturnType<typeof import("postgres")>;
}

describe("TenantRolesService", () => {
  let service: TenantRolesService;
  let sql: ReturnType<typeof createMockSql>;

  beforeEach(async () => {
    sql = createMockSql();

    const module = await Test.createTestingModule({
      providers: [
        TenantRolesRepository,
        TenantRolesService,
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    service = module.get(TenantRolesService);
  });

  describe("seedSystemRole", () => {
    it("should return existing system role ID if present", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "role-1" },
      ]);
      const id = await service.seedSystemRole("t1");
      expect(id).toBe("role-1");
    });

    it("should create and return new system role ID if absent", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      const id = await service.seedSystemRole("t1");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
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
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
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
          tenant_id: "t1",
          name: "admin",
          description: null,
          is_system: true,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
          user_count: 2,
        },
      ];
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce(rows);
      const result = await service.listByTenant("t1");
      expect(result).toHaveLength(1);
      expect(result[0].user_count).toBe(2);
    });
  });

  describe("getWithPermissions", () => {
    it("should throw NotFoundException if role not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.getWithPermissions("nonexistent"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("should return role with permissions", async () => {
      const role = {
        id: "r1",
        tenant_id: "t1",
        name: "editor",
        description: null,
        is_system: false,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([role]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { resource: "agents", action: "read" },
      ]);
      const result = await service.getWithPermissions("r1");
      expect(result.permissions).toHaveLength(1);
      expect(result.permissions[0].resource).toBe("agents");
    });
  });

  describe("delete", () => {
    it("should throw NotFoundException if role not found", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.delete("nonexistent")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException for system role", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "r1", is_system: true },
      ]);
      await expect(service.delete("r1")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("should throw BadRequestException if role has active users", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "r1", is_system: false },
      ]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "u1" },
      ]);
      await expect(service.delete("r1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("should soft-delete a role with no users", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "r1", is_system: false },
      ]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(service.delete("r1")).resolves.toBeUndefined();
    });
  });

  describe("update", () => {
    it("throws NotFoundException when role missing", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([]);
      await expect(
        service.update("missing", { name: "x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws ForbiddenException when renaming system role", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "r1",
          tenant_id: "t1",
          name: "tenant_admin",
          is_system: true,
        },
      ]);
      await expect(
        service.update("r1", { name: "other" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("throws ConflictException for duplicate name", async () => {
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        {
          id: "r1",
          tenant_id: "t1",
          name: "editor",
          is_system: false,
        },
      ]);
      (sql as unknown as ReturnType<typeof mock>).mockResolvedValueOnce([
        { id: "other" },
      ]);
      await expect(
        service.update("r1", { name: "taken" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
