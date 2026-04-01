import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import type { Sql } from "postgres";
import { HealthController } from "../../src/modules/health/health.controller";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

describe("HealthController", () => {
  it("returns ok when SELECT 1 succeeds", async () => {
    const sql = Object.assign(
      () => Promise.resolve([]),
      { json: (x: never) => x, unsafe: mock() },
    ) as Sql;

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: POSTGRES_SQL, useValue: sql }],
    }).compile();
    const controller = moduleRef.get(HealthController);

    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.postgres).toBe("connected");
  });

  it("returns degraded when SELECT 1 fails", async () => {
    const sql = Object.assign(
      () => Promise.reject(new Error("econnrefused")),
      { json: (x: never) => x, unsafe: mock() },
    ) as Sql;

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: POSTGRES_SQL, useValue: sql }],
    }).compile();
    const controller = moduleRef.get(HealthController);

    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe("disconnected");
  });
});
