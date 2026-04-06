import { describe, it, expect } from "bun:test";
import { Test } from "@nestjs/testing";
import { TokenRepository } from "../../src/modules/token/token.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { Sql } from "../../src/providers/postgres.provider";

describe("TokenRepository", () => {
  it("findClientByClientId queries api_clients", async () => {
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenRepository,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    const repo = moduleRef.get(TokenRepository);
    await repo.findClientByClientId("yoizen_abc");

    expect(captured).toContain("FROM api_clients");
    expect(captured).toContain("yoizen_abc");
  });

  it("findTenantUserWithTenant joins roles", async () => {
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenRepository,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    const repo = moduleRef.get(TokenRepository);
    await repo.findTenantUserWithTenant("u@x.com", "tenant-a");

    expect(captured).toContain("JOIN tenant_roles");
    expect(captured).toContain("tenant-a");
  });
});
