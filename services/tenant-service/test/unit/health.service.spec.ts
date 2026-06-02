import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createMockMongoClient } from "@yoizen/testing";
import type { ITenantProvisionerState } from "@yoizen/shared";
import { HealthService } from "../../src/modules/health/health.service";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";
import { MONGO_CLIENT } from "../../src/providers/platform-mongo.provider";
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

describe("HealthService", () => {
  let service: HealthService;
  let mongoClient: ReturnType<typeof createMockMongoClient>;
  let k8sApi: { listNamespace: ReturnType<typeof mock> };
  let provisioner: IFakeProvisioner;

  beforeEach(async () => {
    mongoClient = {
      db: () => ({
        command: () => Promise.resolve({ ok: 1 }),
      }),
    } as unknown as ReturnType<typeof createMockMongoClient>;
    k8sApi = {
      listNamespace: mock(() => Promise.resolve({ items: [] })),
    };
    const fake = buildFakeConsumer("running");
    provisioner = fake.ref;

    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: MONGO_CLIENT, useValue: mongoClient },
        { provide: TenantProvisionConsumerService, useValue: fake.service },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it("returns ok when kubernetes, mongo and provisioner are healthy", async () => {
    const result = await service.getStatus();
    expect(result.status).toBe("ok");
    expect(result.kubernetes).toBe("connected");
    expect(result.mongo).toBe("connected");
    expect(result.provisioner).toBe("running");
  });

  it("returns degraded when mongo fails but provisioner is running", async () => {
    const brokenClient = {
      db: () => ({
        command: () => Promise.reject(new Error("connection refused")),
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: MONGO_CLIENT, useValue: brokenClient },
        {
          provide: TenantProvisionConsumerService,
          useValue: buildFakeConsumer("running").service,
        },
      ],
    }).compile();
    const brokenService = moduleRef.get(HealthService);
    const result = await brokenService.getStatus();
    expect(result.status).toBe("degraded");
    expect(result.mongo).toBe("disconnected");
    expect(result.provisioner).toBe("running");
  });

  it("returns degraded when kubernetes fails but provisioner is running", async () => {
    k8sApi.listNamespace.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await service.getStatus();
    expect(result.status).toBe("degraded");
    expect(result.kubernetes).toBe("disconnected");
    expect(result.provisioner).toBe("running");
  });

  it("returns degraded when the provisioner supervisor is in error backoff", async () => {
    provisioner.state = "degraded";
    const result = await service.getStatus();
    expect(result.status).toBe("degraded");
    expect(result.provisioner).toBe("degraded");
  });

  it("returns error when the provisioner supervisor is stopped", async () => {
    provisioner.state = "stopped";
    const result = await service.getStatus();
    expect(result.status).toBe("error");
    expect(result.provisioner).toBe("stopped");
  });

  it("escalates to error if provisioner is stopped even with healthy infra", async () => {
    provisioner.state = "stopped";
    const result = await service.getStatus();
    expect(result.status).toBe("error");
    expect(result.kubernetes).toBe("connected");
    expect(result.mongo).toBe("connected");
  });
});
