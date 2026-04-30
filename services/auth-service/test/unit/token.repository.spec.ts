import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TokenRepository } from "../../src/modules/token/token.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import { AuthTenantConnectionManager } from "../../src/providers/auth-tenant-connection-manager";
import type { Sql } from "../../src/providers/postgres.provider";

function makePool() {
  let captured = "";
  const fn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      captured = strings.reduce(
        (acc, s, i) => acc + s + String(values[i] ?? ""),
        "",
      );
      return Promise.resolve([] as unknown);
    },
    {},
  ) as unknown as Sql;
  return {
    sql: fn,
    get captured() {
      return captured;
    },
  };
}

function makeSql(
  handler: (
    query: string,
    values: readonly unknown[],
  ) => Promise<unknown>,
): Sql {
  return Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce(
        (acc, s, i) =>
          acc + s + (i < values.length ? `$${String(i + 1)}` : ""),
        "",
      );
      return handler(query, values);
    },
    {},
  ) as unknown as Sql;
}

describe("TokenRepository", () => {
  it("findClientByClientId queries api_clients", async () => {
    const platform = makePool();

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenRepository,
        { provide: POSTGRES_SQL, useValue: platform.sql },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema: mock(() => Promise.resolve(platform.sql)) },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenRepository);
    await repo.findClientByClientId("yoizen_abc");

    expect(platform.captured).toContain("FROM api_clients");
    expect(platform.captured).toContain("yoizen_abc");
  });

  it("findTenantUserWithTenant joins roles on tenant pool", async () => {
    const tenant = makePool();
    const ensureSchema = mock(() => Promise.resolve(tenant.sql));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenRepository,
        { provide: POSTGRES_SQL, useValue: tenant.sql },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenRepository);
    await repo.findTenantUserWithTenant("u@x.com", "tenant-a");

    expect(ensureSchema).toHaveBeenCalledWith("tenant-a");
    expect(tenant.captured).toContain("JOIN tenant_roles");
  });

  it("findTenantUserByEmailAnyTenant resolves tenant names and probes only ready tenants", async () => {
    let platformCaptured = "";
    const platformSql = makeSql(async (query) => {
      platformCaptured = query;
      if (query.includes("FROM tenants")) {
        return Promise.resolve([{ name: "acme" }] as const);
      }
      return Promise.resolve([]);
    });

    const tenantSql = makeSql(async () =>
      Promise.resolve([
        {
          id: "u1",
          email: "a@x.com",
          password_hash: "hash",
          role_name: "tenant_admin",
          is_system: true,
        },
      ]),
    );
    const ensureSchema = mock((tenantName: string) =>
      Promise.resolve(tenantName === "acme" ? tenantSql : platformSql),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenRepository,
        { provide: POSTGRES_SQL, useValue: platformSql },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenRepository);
    const rows = await repo.findTenantUserByEmailAnyTenant("a@x.com");

    expect(platformCaptured).toContain("SELECT name");
    expect(platformCaptured).toContain("provisioning_status = 'ready'");
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
    const platformSql = makeSql(async (query) => {
      if (query.includes("FROM tenants")) {
        return Promise.resolve([
          { name: "first" },
          { name: "second" },
          { name: "third" },
        ]);
      }
      return Promise.resolve([]);
    });
    const ensureSchema = mock(async (tenantName: string) => {
      if (tenantName === "first") {
        return makeSql(async () => Promise.reject(new Error("ENOTFOUND")));
      }
      if (tenantName === "second" || tenantName === "third") {
        return makeSql(async (_query, values) =>
          Promise.resolve([
            {
              id: `${tenantName}-user`,
              email: values[0],
              password_hash: "hash",
              role_name: "tenant_admin",
              is_system: true,
            },
          ]),
        );
      }
      return makeSql(async () => Promise.resolve([]));
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenRepository,
        { provide: POSTGRES_SQL, useValue: platformSql },
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TokenRepository);
    const rows = await repo.findTenantUserByEmailAnyTenant("x@x.com");

    expect(rows.length).toBe(2);
    expect(rows[0]?.tenant_id).toBe("second");
    expect(rows[1]?.tenant_id).toBe("third");
    // first (error) + second + third (breaks right after collecting 2 matches)
    expect(ensureSchema).toHaveBeenCalledTimes(3);
  });
});
