import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockPostgresSql } from "@yoizen/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { HealthService } from "../../src/modules/health/health.service";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";
import { PLATFORM_POSTGRES_SQL } from "../../src/providers/platform-postgres.provider";

describe("HealthController (tenant-service)", () => {
  let controller: HealthController;
  let sql: ReturnType<typeof createMockPostgresSql>;
  let k8sApi: { listNamespace: ReturnType<typeof mock> };

  beforeEach(async () => {
    sql = createMockPostgresSql(mock, [{ "?column?": 1 }]);
    k8sApi = {
      listNamespace: mock(() => Promise.resolve({ items: [] })),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: PLATFORM_POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("returns ok when kubernetes and postgres are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.kubernetes).toBe("connected");
    expect(result.postgres).toBe("connected");
  });

  it("returns degraded when postgres is down", async () => {
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("connected");
    expect(result.postgres).toBe("disconnected");
  });

  it("returns degraded when kubernetes is unreachable", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.postgres).toBe("connected");
  });

  it("returns degraded when both dependencies are down", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("k8s down"));
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("pg down"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.postgres).toBe("disconnected");
  });
});
