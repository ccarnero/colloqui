import "../setup-env";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ProvisioningStatus, TenantDatabaseTier } from "@yoizen/shared";
import { TENANTS_REPOSITORY } from "../../src/modules/tenants/tenants.repository.interface";
import { TenantsService } from "../../src/modules/tenants/tenants.service";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";
import { JETSTREAM_MANAGER } from "../../src/providers/nats.module";
import { TenantDeletionPublisher } from "../../src/providers/tenant-deletion-publisher.service";
import { TenantProvisionPublisher } from "../../src/providers/tenant-provision-publisher.service";
import { TENANT_PROVISIONER } from "../../src/providers/tenant-provisioner.interface";

// T04 tests touch the messaging-ceiling env vars; keep them hermetic.
const originalCeilings = {
  bytes: process.env.MESSAGING_MAX_BYTES_CEILING,
  replicas: process.env.MESSAGING_MAX_REPLICAS_CEILING,
};
afterEach(() => {
  if (originalCeilings.bytes === undefined) {
    delete process.env.MESSAGING_MAX_BYTES_CEILING;
  } else {
    process.env.MESSAGING_MAX_BYTES_CEILING = originalCeilings.bytes;
  }
  if (originalCeilings.replicas === undefined) {
    delete process.env.MESSAGING_MAX_REPLICAS_CEILING;
  } else {
    process.env.MESSAGING_MAX_REPLICAS_CEILING = originalCeilings.replicas;
  }
});

const baseRow = {
  configuration: {} as Record<string, unknown>,
  tier: TenantDatabaseTier.Shared,
  messaging_tier: "free" as const,
  created_at: new Date("2024-01-01"),
  updated_at: new Date("2024-01-02"),
  provisioning_status: ProvisioningStatus.Ready,
  provisioning_error: null as string | null,
  provisioning_started_at: null as Date | null,
  provisioning_completed_at: null as Date | null,
};

describe("TenantsService", () => {
  let service: TenantsService;
  let repository: {
    findByName: ReturnType<typeof mock>;
    findById: ReturnType<typeof mock>;
    create: ReturnType<typeof mock>;
    findAll: ReturnType<typeof mock>;
    updateConfiguration: ReturnType<typeof mock>;
    updateMessagingTier: ReturnType<typeof mock>;
    deleteByName: ReturnType<typeof mock>;
  };
  let k8sApi: {
    listNamespace: ReturnType<typeof mock>;
    deleteNamespace: ReturnType<typeof mock>;
  };
  let publisher: { publishProvisionRequested: ReturnType<typeof mock> };
  let deletionPublisher: { publishTenantDeleted: ReturnType<typeof mock> };
  let tenantProvisioner: { deprovisionShared: ReturnType<typeof mock> };
  let jsm: {
    streams: {
      info: ReturnType<typeof mock>;
      update: ReturnType<typeof mock>;
    };
  };

  beforeEach(async () => {
    repository = {
      findByName: mock(() => Promise.resolve(null)),
      findById: mock(() => Promise.resolve(null)),
      create: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "tenant-a",
          ...baseRow,
        })
      ),
      findAll: mock(() =>
        Promise.resolve([
          {
            id: "tid-1",
            name: "tenant-a",
            configuration: {},
            ...baseRow,
          },
        ])
      ),
      updateConfiguration: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "tenant-a",
          configuration: { yFlowUrl: "https://flow" },
          ...baseRow,
        })
      ),
      updateMessagingTier: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "tenant-a",
          ...baseRow,
          messaging_tier: "pro" as const,
        })
      ),
      deleteByName: mock(() => Promise.resolve(true)),
    };

    k8sApi = {
      listNamespace: mock(() => Promise.resolve({ items: [] })),
      deleteNamespace: mock(() => Promise.resolve({})),
    };

    publisher = {
      publishProvisionRequested: mock(() => Promise.resolve()),
    };

    deletionPublisher = {
      publishTenantDeleted: mock(() => undefined),
    };

    tenantProvisioner = {
      deprovisionShared: mock(() => Promise.resolve()),
    };

    jsm = {
      streams: {
        info: mock(() => Promise.reject(new Error("stream not found"))),
        update: mock(() => Promise.resolve({})),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: TENANTS_REPOSITORY, useValue: repository },
        { provide: TenantProvisionPublisher, useValue: publisher },
        { provide: TenantDeletionPublisher, useValue: deletionPublisher },
        { provide: TENANT_PROVISIONER, useValue: tenantProvisioner },
        { provide: JETSTREAM_MANAGER, useValue: jsm },
      ],
    }).compile();

    service = moduleRef.get(TenantsService);
  });

  it("creates tenant row, publishes provision request, returns 202 shape", async () => {
    const created = await service.createTenant("tenant-a", undefined, {});
    expect(created.name).toBe("tenant-a");
    expect(created.tier).toBe(TenantDatabaseTier.Shared);
    expect(created.provisioningStatus).toBe(ProvisioningStatus.Pending);
    expect(created.id).toBe("tid-1");
    expect(created.statusUrl).toBe("/api/tenants/tid-1");
    expect(publisher.publishProvisionRequested).toHaveBeenCalledTimes(1);
  });

  it("throws conflict when tenant already exists", async () => {
    repository.findByName.mockResolvedValueOnce({ name: "tenant-a" });
    await expect(
      service.createTenant("tenant-a", undefined, {})
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("throws not found for unknown tenant", async () => {
    repository.findByName.mockResolvedValueOnce(null);
    await expect(service.getTenant("missing")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  const tenantNamespace = {
    metadata: {
      name: "tenant-a-dev-ns",
      labels: {
        "yoizen.io/environment": "dev",
        "yoizen.io/tenant": "tenant-a",
      },
    },
    status: { phase: "Active" },
  };

  it("listTenants maps repository rows", async () => {
    const rows = await service.listTenants();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("tenant-a");
    expect(rows[0]?.id).toBe("tid-1");
    expect(rows[0]?.environment).toBe("dev");
  });

  it("getTenant for shared tenant lists the K8s namespace and reports the shared host", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    const detail = await service.getTenant("tenant-a");
    expect(detail.tier).toBe(TenantDatabaseTier.Shared);
    expect(detail.namespaces).toHaveLength(1);
    expect(detail.namespaces[0]?.name).toBe("tenant-a-dev-ns");
    expect(detail.namespaces[0]?.phase).toBe("Active");
    expect(detail.mongoHost).toBe(
      "mongo-shared.support-services-dev.svc.cluster.local"
    );
  });

  it("getTenant for dedicated tenant lists the namespace and reports the per-tenant host", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
      tier: TenantDatabaseTier.Dedicated,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    const detail = await service.getTenant("tenant-a");
    expect(detail.tier).toBe(TenantDatabaseTier.Dedicated);
    expect(detail.namespaces).toHaveLength(1);
    expect(detail.mongoHost).toBe("mongo.tenant-a-dev-ns.svc.cluster.local");
  });

  it("getTenantById returns detail for dedicated tenant", async () => {
    repository.findById.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
      tier: TenantDatabaseTier.Dedicated,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    const detail = await service.getTenantById(
      "550e8400-e29b-41d4-a716-446655440000"
    );
    expect(detail.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(detail.namespaces).toHaveLength(1);
  });

  it("updateTenant returns detail when configuration updates", async () => {
    repository.updateConfiguration.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
      configuration: { yFlowUrl: "https://flow.example" },
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    const detail = await service.updateTenant("tenant-a", {
      configuration: { yFlowUrl: "https://flow.example" },
    });
    expect(detail.configuration).toEqual({ yFlowUrl: "https://flow.example" });
    expect(detail.namespaces).toHaveLength(1);
    expect(repository.updateMessagingTier).not.toHaveBeenCalled();
  });

  it("updateTenant with messagingTier only persists the tier and skips configuration (stream absent)", async () => {
    // Default jsm.streams.info mock rejects — the T04 absent-stream branch:
    // nothing to reconcile, the tier persists and creation applies it.
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    const detail = await service.updateTenant("tenant-a", {
      messagingTier: "pro",
    });
    expect(repository.updateMessagingTier).toHaveBeenCalledWith(
      "tenant-a",
      "pro"
    );
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
    expect(jsm.streams.update).not.toHaveBeenCalled();
    expect(detail.messagingTier).toBe("pro");
  });

  it("updateTenant reconciles the live stream on a tier GROW (T04)", async () => {
    delete process.env.MESSAGING_MAX_BYTES_CEILING;
    delete process.env.MESSAGING_MAX_REPLICAS_CEILING;
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow, // messaging_tier free
    });
    jsm.streams.info.mockResolvedValueOnce({
      config: {
        name: "INGRESS-TENANT-A",
        subjects: ["evt.tenant-a.>"],
        retention: "limits",
        max_age: 1,
        max_bytes: 1,
      },
      state: { bytes: 100 },
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });

    await service.updateTenant("tenant-a", { messagingTier: "pro" });

    expect(jsm.streams.update).toHaveBeenCalledTimes(1);
    const [streamName, cfg] = jsm.streams.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(streamName).toBe("INGRESS-TENANT-A");
    // pro limits, unclamped (no env ceilings): 14d, 5 GiB, 1 MiB, 1 replica.
    expect(cfg.max_bytes).toBe(5_368_709_120);
    expect(cfg.max_age).toBe(14 * 24 * 60 * 60 * 1_000_000_000);
    expect(cfg.max_msg_size).toBe(1_048_576);
    expect(cfg.num_replicas).toBe(1);
    // Existing non-limit config fields survive the update untouched.
    expect(cfg.subjects).toEqual(["evt.tenant-a.>"]);
    expect(repository.updateMessagingTier).toHaveBeenCalledWith(
      "tenant-a",
      "pro"
    );
  });

  it("updateTenant REFUSES a shrink below current stream usage with 409 (T04)", async () => {
    delete process.env.MESSAGING_MAX_BYTES_CEILING;
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
      messaging_tier: "enterprise" as const,
    });
    jsm.streams.info.mockResolvedValueOnce({
      config: { name: "INGRESS-TENANT-A" },
      // More bytes stored than free's 1 GiB allows — shrink would discard.
      state: { bytes: 2_000_000_000 },
    });

    await expect(
      service.updateTenant("tenant-a", { messagingTier: "free" })
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    expect(jsm.streams.update).not.toHaveBeenCalled();
    // The refused tier must NOT persist — record and stream stay coherent.
    expect(repository.updateMessagingTier).not.toHaveBeenCalled();
  });

  it("updateTenant does NOT persist the tier when streams.info fails with a transport error (T04)", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
    });
    // NOT a stream-not-found error — a broken broker connection must
    // propagate instead of being read as "absent" and drifting state.
    jsm.streams.info.mockRejectedValueOnce(new Error("CONNECTION_REFUSED"));

    await expect(
      service.updateTenant("tenant-a", { messagingTier: "pro" })
    ).rejects.toThrow("CONNECTION_REFUSED");

    expect(jsm.streams.update).not.toHaveBeenCalled();
    expect(repository.updateMessagingTier).not.toHaveBeenCalled();
  });

  it("updateTenant maps a broker-rejected stream update to 409 and does not persist (T04)", async () => {
    delete process.env.MESSAGING_MAX_BYTES_CEILING;
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
    });
    jsm.streams.info.mockResolvedValueOnce({
      config: { name: "INGRESS-TENANT-A" },
      state: { bytes: 100 },
    });
    jsm.streams.update.mockRejectedValueOnce(
      new Error("insufficient storage resources available")
    );

    await expect(
      service.updateTenant("tenant-a", { messagingTier: "pro" })
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    expect(repository.updateMessagingTier).not.toHaveBeenCalled();
  });

  it("updateTenant with an unchanged messagingTier does no stream or persist work (T04)", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
      messaging_tier: "pro" as const,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });

    const detail = await service.updateTenant("tenant-a", {
      messagingTier: "pro",
    });

    expect(jsm.streams.info).not.toHaveBeenCalled();
    expect(jsm.streams.update).not.toHaveBeenCalled();
    expect(repository.updateMessagingTier).not.toHaveBeenCalled();
    expect(detail.messagingTier).toBe("pro");
  });

  it("updateTenant rejects a body with neither configuration nor messagingTier", async () => {
    await expect(service.updateTenant("tenant-a", {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
    expect(repository.updateMessagingTier).not.toHaveBeenCalled();
  });

  it("createTenant threads messagingTier to the repository and echoes it", async () => {
    repository.create.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
      messaging_tier: "enterprise" as const,
    });
    const created = await service.createTenant(
      "tenant-a",
      undefined,
      {},
      "enterprise"
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.any(String),
      "tenant-a",
      TenantDatabaseTier.Shared,
      {},
      "enterprise"
    );
    expect(created.messagingTier).toBe("enterprise");
  });

  it("createTenant defaults messagingTier to free", async () => {
    const created = await service.createTenant("tenant-a", undefined, {});
    expect(repository.create).toHaveBeenCalledWith(
      expect.any(String),
      "tenant-a",
      TenantDatabaseTier.Shared,
      {},
      "free"
    );
    expect(created.messagingTier).toBe("free");
  });

  it("deleteTenant for shared tier drops DB+role AND cascades the namespace", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    await service.deleteTenant("tenant-a");
    expect(tenantProvisioner.deprovisionShared).toHaveBeenCalledWith(
      "tenant-a"
    );
    expect(k8sApi.deleteNamespace).toHaveBeenCalledWith({
      name: "tenant-a-dev-ns",
    });
    expect(repository.deleteByName).toHaveBeenCalledWith("tenant-a");
    expect(deletionPublisher.publishTenantDeleted).toHaveBeenCalledWith({
      tenantId: "tid-1",
      name: "tenant-a",
      tier: TenantDatabaseTier.Shared,
    });
  });

  it("deleteTenant for dedicated tier cascades the namespace only (no shared deprovision)", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
      tier: TenantDatabaseTier.Dedicated,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [tenantNamespace] });
    await service.deleteTenant("tenant-a");
    expect(k8sApi.deleteNamespace).toHaveBeenCalledWith({
      name: "tenant-a-dev-ns",
    });
    expect(tenantProvisioner.deprovisionShared).not.toHaveBeenCalled();
    expect(repository.deleteByName).toHaveBeenCalledWith("tenant-a");
    expect(deletionPublisher.publishTenantDeleted).toHaveBeenCalledWith({
      tenantId: "tid-1",
      name: "tenant-a",
      tier: TenantDatabaseTier.Dedicated,
    });
  });

  it("deleteTenant throws NotFound when the tenant row is absent", async () => {
    repository.findByName.mockResolvedValueOnce(null);
    await expect(service.deleteTenant("missing")).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(tenantProvisioner.deprovisionShared).not.toHaveBeenCalled();
    expect(k8sApi.deleteNamespace).not.toHaveBeenCalled();
    expect(repository.deleteByName).not.toHaveBeenCalled();
    expect(deletionPublisher.publishTenantDeleted).not.toHaveBeenCalled();
  });

  it("deleteTenant returns 409 Conflict while the tenant is still provisioning (race protection)", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
      provisioning_status: ProvisioningStatus.Provisioning,
    });
    let thrown: HttpException | null = null;
    try {
      await service.deleteTenant("tenant-a");
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = thrown!.getResponse() as Record<string, unknown>;
    expect(body.provisioningStatus).toBe(ProvisioningStatus.Provisioning);
    // Cleanup must NOT have run — the race protection's whole point is
    // to leave the in-flight provisioning untouched.
    expect(tenantProvisioner.deprovisionShared).not.toHaveBeenCalled();
    expect(k8sApi.deleteNamespace).not.toHaveBeenCalled();
    expect(repository.deleteByName).not.toHaveBeenCalled();
    expect(deletionPublisher.publishTenantDeleted).not.toHaveBeenCalled();
  });

  it("deleteTenant proceeds normally when the tenant is in 'pending' state (no provisioning resources to race)", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
      provisioning_status: ProvisioningStatus.Pending,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [] });
    await service.deleteTenant("tenant-a");
    // Shared tier deprovision is still attempted (idempotent: drops
    // DROP DATABASE IF EXISTS, DROP ROLE IF EXISTS); the consumer will
    // term its in-flight message via PermanentError [lookup] when it
    // eventually picks it up.
    expect(tenantProvisioner.deprovisionShared).toHaveBeenCalledWith(
      "tenant-a"
    );
    expect(repository.deleteByName).toHaveBeenCalledWith("tenant-a");
  });

  it("deleteTenant proceeds normally when the tenant is in 'failed' state", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
      provisioning_status: ProvisioningStatus.Failed,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [] });
    await service.deleteTenant("tenant-a");
    expect(repository.deleteByName).toHaveBeenCalledWith("tenant-a");
  });
});
