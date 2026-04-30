import { describe, it, expect, beforeEach, mock } from "bun:test";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createMockPostgresSql } from "@yoizen/testing";
import type { ITenantProvisionerState } from "@yoizen/shared";
import { HealthController } from "../../src/modules/health/health.controller";
import { HealthService } from "../../src/modules/health/health.service";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";
import { PLATFORM_POSTGRES_SQL } from "../../src/providers/platform-postgres.provider";
import { TenantProvisionConsumerService } from "../../src/modules/provisioning/tenant-provision-consumer.service";

interface IFakeProvisioner {
  state: ITenantProvisionerState;
}

function buildFakeConsumer(initial: ITenantProvisionerState): {
  ref: IFakeProvisioner;
  service: TenantProvisionConsumerService;
} {
  const ref: IFakeProvisioner = { state: initial };
  const service = {
    getProvisionerState: () => ref.state,
    getRunnerState: () => null,
  } as unknown as TenantProvisionConsumerService;
  return { ref, service };
}

describe("HealthController (tenant-service)", () => {
  let controller: HealthController;
  let sql: ReturnType<typeof createMockPostgresSql>;
  let k8sApi: { listNamespace: ReturnType<typeof mock> };
  let provisioner: IFakeProvisioner;

  beforeEach(async () => {
    sql = createMockPostgresSql(mock, [{ "?column?": 1 }]);
    k8sApi = {
      listNamespace: mock(() => Promise.resolve({ items: [] })),
    };
    const fake = buildFakeConsumer("running");
    provisioner = fake.ref;

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: PLATFORM_POSTGRES_SQL, useValue: sql },
        { provide: TenantProvisionConsumerService, useValue: fake.service },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("returns ok when kubernetes, postgres and provisioner are healthy", async () => {
    const result = await controller.check();
    expect(result.status).toBe("ok");
    expect(result.kubernetes).toBe("connected");
    expect(result.postgres).toBe("connected");
    expect(result.provisioner).toBe("running");
  });

  it("returns degraded with HTTP 200 when postgres is down", async () => {
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("connected");
    expect(result.postgres).toBe("disconnected");
  });

  it("returns degraded with HTTP 200 when kubernetes is unreachable", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.postgres).toBe("connected");
  });

  it("returns degraded with HTTP 200 when both dependencies are down", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("k8s down"));
    (sql as unknown as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("pg down"),
    );
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.postgres).toBe("disconnected");
  });

  it("returns degraded with HTTP 200 when provisioner is in error backoff", async () => {
    provisioner.state = "degraded";
    const result = await controller.check();
    expect(result.status).toBe("degraded");
    expect(result.provisioner).toBe("degraded");
  });

  it("throws 503 (forces Knative restart) when provisioner is stopped", async () => {
    provisioner.state = "stopped";
    let thrown: HttpException | null = null;
    try {
      await controller.check();
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(503);
    const body = thrown!.getResponse() as { status: string; provisioner: string };
    expect(body.status).toBe("error");
    expect(body.provisioner).toBe("stopped");
  });
});
