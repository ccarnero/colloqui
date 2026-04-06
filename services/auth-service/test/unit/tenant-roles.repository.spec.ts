import { describe, it, expect } from "bun:test";
import { Test } from "@nestjs/testing";
import { TenantRolesRepository } from "../../src/modules/tenant-roles/tenant-roles.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { Sql } from "../../src/providers/postgres.provider";

describe("TenantRolesRepository", () => {
  it("createRoleWithPermissions runs transaction", async () => {
    const calls: string[] = [];
    const mockTx = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push(
          strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ""), ""),
        );
        return Promise.resolve([]);
      },
      {},
    ) as unknown as Sql;

    const mockBegin = async (fn: (tx: Sql) => Promise<void>) => {
      await fn(mockTx);
    };

    const mockSql = Object.assign(
      () => Promise.resolve([]),
      { begin: mockBegin },
    ) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantRolesRepository,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    const repo = moduleRef.get(TenantRolesRepository);
    await repo.createRoleWithPermissions({
      id: "role1",
      tenantId: "t1",
      name: "editor",
      description: "d",
      permissions: [{ resource: "users", action: "read" }],
    });

    expect(calls.some((c) => c.includes("INSERT INTO tenant_roles"))).toBe(
      true,
    );
    expect(
      calls.some((c) => c.includes("INSERT INTO tenant_role_permissions")),
    ).toBe(true);
  });
});
