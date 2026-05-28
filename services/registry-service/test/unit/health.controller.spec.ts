import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { HealthController } from "../../src/modules/health/health.controller";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { POSTGRES_SQL } from "../../src/providers/postgres.module";

describe("HealthController", () => {
  let controller: HealthController;
  let mongoClient: { db: ReturnType<typeof mock> };
  let sql: ReturnType<typeof mock>;
  let k8sApi: { listNamespace: ReturnType<typeof mock> };
  let originalEngine: string | undefined;

  beforeEach(async () => {
    originalEngine = process.env.DB_ENGINE;
    process.env.DB_ENGINE = "mongo";

    mongoClient = {
      db: mock((name: string) => ({
        command: mock(() =>
          name === "admin"
            ? Promise.resolve({ ok: 1 })
            : Promise.reject(new Error("wrong db")),
        ),
      })),
    };
    sql = mock(async () => []);
    k8sApi = {
      listNamespace: mock(() => Promise.resolve({ items: [] })),
    };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: MONGO_CLIENT, useValue: mongoClient },
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: K8S_CORE_API, useValue: k8sApi },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  afterEach(() => {
    if (originalEngine === undefined) {
      delete process.env.DB_ENGINE;
    } else {
      process.env.DB_ENGINE = originalEngine;
    }
  });

  it("returns ok when kubernetes and mongo succeed", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.kubernetes).toBe("connected");
    expect(result.mongo).toBe("connected");
  });

  it("returns degraded when kubernetes fails", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("unauthorized"));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.mongo).toBe("connected");
  });

  it("returns degraded when mongo fails", async () => {
    mongoClient.db = mock((name: string) => ({
      command: mock(() =>
        name === "admin"
          ? Promise.reject(new Error("connection refused"))
          : Promise.resolve({ ok: 1 }),
      ),
    }));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("connected");
    expect(result.mongo).toBe("disconnected");
  });

  it("returns postgres status when DB_ENGINE is postgres", async () => {
    process.env.DB_ENGINE = "postgres";
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: MONGO_CLIENT, useValue: mongoClient },
        { provide: POSTGRES_SQL, useValue: sql },
        { provide: K8S_CORE_API, useValue: k8sApi },
      ],
    }).compile();
    const pgController = module.get(HealthController);
    const result = await pgController.check();
    expect(result.status).toBe("ok");
    expect(result.postgres).toBe("connected");
    expect(result.mongo).toBeUndefined();
  });
});
