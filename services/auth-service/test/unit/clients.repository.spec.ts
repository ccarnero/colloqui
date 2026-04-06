import { describe, it, expect } from "bun:test";
import { Test } from "@nestjs/testing";
import { ClientsRepository } from "../../src/modules/clients/clients.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { Sql } from "../../src/providers/postgres.provider";

describe("ClientsRepository", () => {
  it("insertClient uses options object", async () => {
    let captured = "";
    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        captured = strings.reduce(
          (acc, s, i) => acc + s + String(values[i] ?? ""),
          "",
        );
        return Promise.resolve([
          {
            id: "i1",
            client_id: "c1",
            name: "n",
            scope: "platform",
            is_active: true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ]);
      },
      {},
    ) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientsRepository,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    const repo = moduleRef.get(ClientsRepository);
    await repo.insertClient({
      id: "i1",
      clientId: "client_x",
      secretHash: "h",
      name: "n",
      scope: "platform",
    });

    expect(captured).toContain("INSERT INTO api_clients");
    expect(captured).toContain("client_x");
  });
});
