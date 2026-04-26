import { describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { UserRole } from "../../src/modules/users/user.dto";
import { UsersController } from "../../src/modules/users/users.controller";
import { ClientsController } from "../../src/modules/clients/clients.controller";
import { PublicRoutesController } from "../../src/modules/public-routes/public-routes.controller";
import { TenantUsersController } from "../../src/modules/tenant-users/tenant-users.controller";
import { TenantRolesController } from "../../src/modules/tenant-roles/tenant-roles.controller";
import { UsersService } from "../../src/modules/users/users.service";
import { ClientsService } from "../../src/modules/clients/clients.service";
import { PublicRoutesService } from "../../src/modules/public-routes/public-routes.service";
import { TenantUsersService } from "../../src/modules/tenant-users/tenant-users.service";
import { TenantRolesService } from "../../src/modules/tenant-roles/tenant-roles.service";

describe("Auth controllers coverage", () => {
  describe("UsersController", () => {
    it("creates and lists users through service", async () => {
      const service = {
        create: mock(() => Promise.resolve({ id: "u-1" })),
        list: mock(() => Promise.resolve([])),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [{ provide: UsersService, useValue: service }],
      }).compile();
      const controller = moduleRef.get(UsersController);

      await controller.create({
        email: "user@example.com",
        password: "secret",
        role: UserRole.ADMIN,
      } as import("../../src/modules/users/user.dto").CreateUserDto);
      await controller.list();

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledTimes(1);
    });
  });

  describe("ClientsController", () => {
    it("creates, lists and revokes clients", async () => {
      const service = {
        create: mock(() => Promise.resolve({ client_id: "yoizen_x" })),
        list: mock(() => Promise.resolve([])),
        revoke: mock(() => Promise.resolve()),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [ClientsController],
        providers: [{ provide: ClientsService, useValue: service }],
      }).compile();
      const controller = moduleRef.get(ClientsController);

      await controller.create({
        name: "integration-client",
        scope: "platform",
      } as import("../../src/modules/clients/client.dto").CreateClientDto);
      await controller.list(undefined);
      await controller.revoke("client-1");

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledTimes(1);
      expect(service.revoke).toHaveBeenCalledTimes(1);
    });
  });

  describe("PublicRoutesController", () => {
    it("creates/lists/removes public routes", async () => {
      const service = {
        create: mock(() => Promise.resolve({ id: "r-1" })),
        list: mock(() => Promise.resolve([])),
        remove: mock(() => Promise.resolve()),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [PublicRoutesController],
        providers: [{ provide: PublicRoutesService, useValue: service }],
      }).compile();
      const controller = moduleRef.get(PublicRoutesController);

      await controller.create(undefined, {
        method: "GET",
        path_pattern: "/health",
        scope: "platform",
      } as import("../../src/modules/public-routes/public-route.dto").CreatePublicRouteDto);
      await controller.list(undefined);
      await controller.remove(undefined, "r-1");

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.list).toHaveBeenCalledTimes(1);
      expect(service.remove).toHaveBeenCalledTimes(1);
    });
  });

  describe("TenantUsersController", () => {
    it("delegates CRUD operations to tenant users service", async () => {
      const service = {
        create: mock(() => Promise.resolve({ id: "tu-1" })),
        listByTenant: mock(() => Promise.resolve([])),
        findById: mock(() => Promise.resolve({ id: "tu-1" })),
        update: mock(() => Promise.resolve({ id: "tu-1" })),
        deactivate: mock(() => Promise.resolve()),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [TenantUsersController],
        providers: [{ provide: TenantUsersService, useValue: service }],
      }).compile();
      const controller = moduleRef.get(TenantUsersController);

      await controller.create({
        tenant_id: "tenant-a",
        email: "tenant@example.com",
        password: "password123",
        role_id: "role-1",
      } as import("../../src/modules/tenant-users/tenant-user.dto").CreateTenantUserDto);
      await controller.list("tenant-a");
      await controller.findOne("tenant-a", "tu-1");
      await controller.update("tenant-a", "tu-1", {});
      await controller.remove("tenant-a", "tu-1");

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.listByTenant).toHaveBeenCalledTimes(1);
      expect(service.findById).toHaveBeenCalledWith("tenant-a", "tu-1");
      expect(service.update).toHaveBeenCalledWith("tenant-a", "tu-1", {});
      expect(service.deactivate).toHaveBeenCalledWith("tenant-a", "tu-1");
    });
  });

  describe("TenantRolesController", () => {
    it("delegates CRUD operations to tenant roles service", async () => {
      const service = {
        create: mock(() => Promise.resolve({ id: "tr-1" })),
        listByTenant: mock(() => Promise.resolve([])),
        getWithPermissions: mock(() => Promise.resolve({ id: "tr-1" })),
        update: mock(() => Promise.resolve({ id: "tr-1" })),
        delete: mock(() => Promise.resolve()),
      };
      const moduleRef = await Test.createTestingModule({
        controllers: [TenantRolesController],
        providers: [{ provide: TenantRolesService, useValue: service }],
      }).compile();
      const controller = moduleRef.get(TenantRolesController);

      await controller.create({
        tenant_id: "tenant-a",
        name: "Admin",
        permissions: [{ resource: "roles", action: "read" }],
      } as import("../../src/modules/tenant-roles/tenant-role.dto").CreateTenantRoleDto);
      await controller.list("tenant-a");
      await controller.findOne("tenant-a", "tr-1");
      await controller.update("tenant-a", "tr-1", {});
      await controller.remove("tenant-a", "tr-1");

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(service.listByTenant).toHaveBeenCalledTimes(1);
      expect(service.getWithPermissions).toHaveBeenCalledWith(
        "tenant-a",
        "tr-1",
      );
      expect(service.update).toHaveBeenCalledWith("tenant-a", "tr-1", {});
      expect(service.delete).toHaveBeenCalledWith("tenant-a", "tr-1");
    });
  });
});
