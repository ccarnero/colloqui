import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantUsersRepository } from "../../src/modules/tenant-users/tenant-users.repository";
import { AuthTenantConnectionManager } from "../../src/providers/auth-tenant-connection-manager";
import type { Sql } from "../../src/providers/postgres.provider";

describe("TenantUsersRepository", () => {
  it("insertUser uses options object", async () => {
    let captured = "";
    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        captured = strings.reduce(
          (acc, s, i) => acc + s + String(values[i] ?? ""),
          "",
        );
        return Promise.resolve([]);
      },
      {},
    ) as unknown as Sql;

    const ensureSchema = mock(() => Promise.resolve(mockSql));

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantUsersRepository,
        {
          provide: AuthTenantConnectionManager,
          useValue: { ensureSchema },
        },
      ],
    }).compile();

    const repo = moduleRef.get(TenantUsersRepository);
    await repo.insertUser({
      id: "u1",
      tenantId: "t1",
      email: "e@x.com",
      passwordHash: "ph",
      roleId: "r1",
      displayName: "Name",
    });

    expect(ensureSchema).toHaveBeenCalledWith("t1");
    expect(captured).toContain("INSERT INTO tenant_users");
    expect(captured).toContain("e@x.com");
  });
});
