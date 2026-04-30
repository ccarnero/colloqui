import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockPostgresSql } from "@yoizen/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import { NATS_CONNECTION } from "../../src/providers/nats.provider";

describe("HealthController", () => {
  let controller: HealthController;
  let sql: ReturnType<typeof createMockPostgresSql>;
  let nc: { isClosed: ReturnType<typeof mock> };

  beforeEach(async () => {
    sql = createMockPostgresSql(mock, [{ "?column?": 1 }]);
    nc = {
      isClosed: mock(() => false),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: NATS_CONNECTION, useValue: nc },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("returns ok when postgres and NATS are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.postgres).toBe("connected");
    expect(result.nats).toBe("connected");
  });

  it("returns degraded when postgres fails", async () => {
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe("disconnected");
    expect(result.nats).toBe("connected");
  });

  it("returns degraded when NATS connection is closed", async () => {
    nc.isClosed.mockReturnValueOnce(true);
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.postgres).toBe("connected");
    expect(result.nats).toBe("disconnected");
  });
});
