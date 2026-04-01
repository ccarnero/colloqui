import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

function createMockSql() {
  const fn = mock(() => Promise.resolve([{ "?column?": 1 }]));
  return fn as unknown as import("postgres").Sql;
}

describe("HealthController", () => {
  let controller: HealthController;
  let sql: ReturnType<typeof createMockSql>;
  let k8sApi: { listNamespace: ReturnType<typeof mock> };

  beforeEach(async () => {
    sql = createMockSql();
    k8sApi = {
      listNamespace: mock(() => Promise.resolve({ items: [] })),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: K8S_CORE_API, useValue: k8sApi },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("returns ok when kubernetes and postgres succeed", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.kubernetes).toBe("connected");
    expect(result.postgres).toBe("connected");
  });

  it("returns degraded when kubernetes fails", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("unauthorized"));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.postgres).toBe("connected");
  });

  it("returns degraded when postgres fails", async () => {
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("connected");
    expect(result.postgres).toBe("disconnected");
  });
});
