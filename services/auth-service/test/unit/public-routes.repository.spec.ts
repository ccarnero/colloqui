import { describe, it, expect, beforeEach } from "bun:test";
import { Test } from "@nestjs/testing";
import { PublicRoutesRepository } from "../../src/modules/public-routes/public-routes.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import type { Sql } from "../../src/providers/postgres.provider";

describe("PublicRoutesRepository", () => {
  beforeEach(() => {
    process.env.PLATFORM_ENVIRONMENT = "dev";
  });

  it("insertRoute includes environment", async () => {
    let captured = "";
    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        captured = strings.reduce(
          (acc, s, i) => acc + s + String(values[i] ?? ""),
          "",
        );
        return Promise.resolve([
          {
            id: "r1",
            method: "GET",
            path_pattern: "/x",
            scope: "platform",
            environment: "dev",
            created_at: new Date(),
          },
        ]);
      },
      {},
    ) as unknown as Sql;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicRoutesRepository,
        { provide: POSTGRES_SQL, useValue: mockSql },
      ],
    }).compile();

    const repo = moduleRef.get(PublicRoutesRepository);
    await repo.insertRoute("r1", "GET", "/x", "platform");

    expect(captured).toContain("INSERT INTO public_routes");
    expect(captured).toContain("dev");
  });
});
