import { describe, it, expect } from "bun:test";
import { Test } from "@nestjs/testing";
import { UsersRepository } from "../../src/modules/users/users.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { Sql } from "../../src/providers/postgres.provider";

describe("UsersRepository", () => {
  it("insertUser forwards parameters to SQL", async () => {
    let captured = "";
    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        captured = strings.reduce(
          (acc, s, i) => acc + s + String(values[i] ?? ""),
          "",
        );
        return Promise.resolve([{ id: "u1" }]);
      },
      {},
    ) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    const repo = moduleRef.get(UsersRepository);
    await repo.insertUser({
      id: "id1",
      email: "a@b.com",
      passwordHash: "hash",
      role: "admin",
    });

    expect(captured).toContain("INSERT INTO platform_users");
    expect(captured).toContain("id1");
    expect(captured).toContain("a@b.com");
  });
});
