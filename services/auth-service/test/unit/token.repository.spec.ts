import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockMongoClient, createMockTenantDb } from "@yoizen/testing";
import { TokenMongoRepository } from "../../src/modules/token/token.mongo.repository";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { AuthTenantConnectionManager } from "../../src/providers/auth-tenant-connection-manager";

describe("TokenMongoRepository", () => {
  it("findClientByClientId queries api_clients", async () => {
    const platformClient = createMockMongoClient(
      new Map([
        [
          "api_clients",
          (operation, args) => {
            if (operation === "findOne") {
              const filter = args[0] as { client_id?: string };
              if (filter.client_id === "yoizen_abc") {
                return {
                  _id: "c1",
                  client_secret_hash: "hash",
                  scope: "platform",
                  is_active: true,
                };
              }
            }
            return null;
          },
        ],
      ]),
      mock,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenMongoRepository,
        { provide: MONGO_CLIENT, useValue: platformClient },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema: mock(() => Promise.resolve(createMockTenantDb(new Map(), mock))) },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenMongoRepository);
    const rows = await repo.findClientByClientId("yoizen_abc");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("c1");
  });

  it("findTenantUserWithTenant joins roles on tenant pool", async () => {
    const tenantDb = createMockTenantDb(
      new Map([
        [
          "tenant_users",
          (operation) => {
            if (operation === "aggregate") {
              return [
                {
                  id: "u1",
                  email: "u@x.com",
                  password_hash: "hash",
                  role_name: "editor",
                  is_system: false,
                },
              ];
            }
            return [];
          },
        ],
      ]),
      mock,
    );
    const ensureSchema = mock(() => Promise.resolve(tenantDb));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenMongoRepository,
        {
          provide: MONGO_CLIENT,
          useValue: createMockMongoClient(new Map(), mock),
        },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenMongoRepository);
    await repo.findTenantUserWithTenant("u@x.com", "tenant-a");

    expect(ensureSchema).toHaveBeenCalledWith("tenant-a");
  });

  it("findTenantUserByEmailAnyTenant resolves tenant names and probes only ready tenants", async () => {
    const platformClient = createMockMongoClient(
      new Map([
        [
          "tenants",
          (operation) => {
            if (operation === "find") {
              return [{ name: "acme" }];
            }
            return [];
          },
        ],
      ]),
      mock,
    );

    const tenantDb = createMockTenantDb(
      new Map([
        [
          "tenant_users",
          (operation) => {
            if (operation === "aggregate") {
              return [
                {
                  id: "u1",
                  email: "a@x.com",
                  password_hash: "hash",
                  role_name: "tenant_admin",
                  is_system: true,
                },
              ];
            }
            return [];
          },
        ],
      ]),
      mock,
    );
    const ensureSchema = mock((tenantName: string) =>
      Promise.resolve(tenantName === "acme" ? tenantDb : createMockTenantDb(new Map(), mock)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenMongoRepository,
        { provide: MONGO_CLIENT, useValue: platformClient },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenMongoRepository);
    const rows = await repo.findTenantUserByEmailAnyTenant("a@x.com");

    expect(ensureSchema).toHaveBeenCalledWith("acme");
    expect(rows).toEqual([
      {
        id: "u1",
        email: "a@x.com",
        password_hash: "hash",
        role_name: "tenant_admin",
        is_system: true,
        tenant_id: "acme",
      },
    ]);
  });

  it("findTenantUserByEmailAnyTenant ignores unreachable tenant pools and stops after ambiguity", async () => {
    const platformClient = createMockMongoClient(
      new Map([
        [
          "tenants",
          (operation) => {
            if (operation === "find") {
              return [{ name: "first" }, { name: "second" }, { name: "third" }];
            }
            return [];
          },
        ],
      ]),
      mock,
    );

    const ensureSchema = mock(async (tenantName: string) => {
      if (tenantName === "first") {
        throw new Error("ENOTFOUND");
      }
      return createMockTenantDb(
        new Map([
          [
            "tenant_users",
            (operation) => {
              if (operation === "aggregate") {
                return [
                  {
                    id: `${tenantName}-user`,
                    email: "x@x.com",
                    password_hash: "hash",
                    role_name: "tenant_admin",
                    is_system: true,
                  },
                ];
              }
              return [];
            },
          ],
        ]),
        mock,
      );
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenMongoRepository,
        { provide: MONGO_CLIENT, useValue: platformClient },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenMongoRepository);
    const rows = await repo.findTenantUserByEmailAnyTenant("x@x.com");

    expect(rows.length).toBe(2);
    expect(rows[0]?.tenant_id).toBe("second");
    expect(rows[1]?.tenant_id).toBe("third");
    expect(ensureSchema).toHaveBeenCalledTimes(3);
  });
});
