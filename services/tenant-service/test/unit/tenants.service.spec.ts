import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ProvisioningStatus } from "@yoizen/shared";
import { TenantsService } from "../../src/modules/tenants/tenants.service";
import { TenantsRepository } from "../../src/modules/tenants/tenants.repository";
import { TenantProvisionPublisher } from "../../src/providers/tenant-provision-publisher.service";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";

const baseRow = {
  configuration: {} as Record<string, unknown>,
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
    deleteByName: ReturnType<typeof mock>;
  };
  let k8sApi: {
    listNamespace: ReturnType<typeof mock>;
    deleteNamespace: ReturnType<typeof mock>;
  };
  let publisher: { publishProvisionRequested: ReturnType<typeof mock> };

  beforeEach(async () => {
    repository = {
      findByName: mock(() => Promise.resolve(null)),
      findById: mock(() => Promise.resolve(null)),
      create: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "tenant-a",
          ...baseRow,
        }),
      ),
      findAll: mock(() =>
        Promise.resolve([
          {
            id: "tid-1",
            name: "tenant-a",
            configuration: {},
            ...baseRow,
          },
        ]),
      ),
      updateConfiguration: mock(() =>
        Promise.resolve({
          id: "tid-1",
          name: "tenant-a",
          configuration: { yFlowUrl: "https://flow" },
          ...baseRow,
        }),
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: TenantsRepository, useValue: repository },
        { provide: TenantProvisionPublisher, useValue: publisher },
      ],
    }).compile();

    service = moduleRef.get(TenantsService);
  });

  it("creates tenant row, publishes provision request, returns 202 shape", async () => {
    const created = await service.createTenant("tenant-a", {});
    expect(created.name).toBe("tenant-a");
    expect(created.provisioningStatus).toBe(ProvisioningStatus.Pending);
    expect(created.id).toBe("tid-1");
    expect(created.statusUrl).toBe("/api/tenants/tid-1");
    expect(publisher.publishProvisionRequested).toHaveBeenCalledTimes(1);
  });

  it("throws conflict when tenant already exists", async () => {
    repository.findByName.mockResolvedValueOnce({ name: "tenant-a" });
    await expect(service.createTenant("tenant-a", {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("throws not found for unknown tenant", async () => {
    repository.findByName.mockResolvedValueOnce(null);
    await expect(service.getTenant("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  const mockNamespace = {
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

  it("getTenant returns detail when tenant exists", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    const detail = await service.getTenant("tenant-a");
    expect(detail.name).toBe("tenant-a");
    expect(detail.id).toBe("tid-1");
    expect(detail.namespaces).toHaveLength(1);
    expect(detail.namespaces[0]?.phase).toBe("Active");
  });

  it("getTenantById returns detail", async () => {
    repository.findById.mockResolvedValueOnce({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    const detail = await service.getTenantById(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(detail.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("updateTenant returns detail when configuration updates", async () => {
    repository.updateConfiguration.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      ...baseRow,
      configuration: { yFlowUrl: "https://flow.example" },
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    const detail = await service.updateTenant("tenant-a", {
      yFlowUrl: "https://flow.example",
    });
    expect(detail.configuration).toEqual({ yFlowUrl: "https://flow.example" });
  });

  it("deleteTenant deletes namespaces and repository row", async () => {
    repository.findByName.mockResolvedValueOnce({
      id: "tid-1",
      name: "tenant-a",
      configuration: {},
      ...baseRow,
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    await service.deleteTenant("tenant-a");
    expect(k8sApi.deleteNamespace).toHaveBeenCalled();
    expect(repository.deleteByName).toHaveBeenCalledWith("tenant-a");
  });
});
