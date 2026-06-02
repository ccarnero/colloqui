import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockTenantDb } from "@yoizen/testing";
import { TenantUsersMongoRepository } from "../../src/modules/tenant-users/tenant-users.mongo.repository";
import { AuthTenantConnectionManager } from "../../src/providers/auth-tenant-connection-manager";

describe("TenantUsersMongoRepository", () => {
  it("insertUser uses options object", async () => {
    let capturedDoc: unknown;
    const tenantDb = createMockTenantDb(
      new Map([
        [
          "tenant_users",
          (operation, args) => {
            if (operation === "insertOne") {
              capturedDoc = args[0];
              return { acknowledged: true };
            }
            return null;
          },
        ],
      ]),
      mock,
    );

    const ensureSchema = mock(() => Promise.resolve(tenantDb));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantUsersMongoRepository,
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TenantUsersMongoRepository);
    await repo.insertUser({
      id: "u1",
      tenantId: "t1",
      email: "e@x.com",
      passwordHash: "ph",
      roleId: "r1",
      displayName: "Name",
    });

    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(capturedDoc).toMatchObject({
      _id: "u1",
      email: "e@x.com",
      role_id: "r1",
      display_name: "Name",
    });
  });
});
