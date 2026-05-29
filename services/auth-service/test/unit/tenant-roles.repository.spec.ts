import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockTenantDb } from "@yoizen/testing";
import { TenantRolesMongoRepository } from "../../src/modules/tenant-roles/tenant-roles.mongo.repository";
import { AuthTenantConnectionManager } from "../../src/providers/auth-tenant-connection-manager";

describe("TenantRolesMongoRepository", () => {
  it("createRoleWithPermissions runs transaction", async () => {
    const calls: string[] = [];
    const tenantDb = createMockTenantDb(
      new Map([
        [
          "tenant_roles",
          (operation, args) => {
            if (operation === "insertOne") {
              calls.push("tenant_roles");
            }
            return { acknowledged: true };
          },
        ],
        [
          "tenant_role_permissions",
          (operation) => {
            if (operation === "insertMany") {
              calls.push("tenant_role_permissions");
            }
            return { insertedCount: 1 };
          },
        ],
      ]),
      mock,
    );

    const ensureSchema = mock(() => Promise.resolve(tenantDb));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRolesMongoRepository,
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TenantRolesMongoRepository);
    await repo.createRoleWithPermissions({
      id: "role1",
      tenantId: "t1",
      name: "editor",
      description: "d",
      permissions: [{ resource: "users", action: "read" }],
    });

    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(calls).toContain("tenant_roles");
    expect(calls).toContain("tenant_role_permissions");
  });
});
