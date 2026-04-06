import "../setup-env";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { TenantsService } from "../../src/modules/tenants/tenants.service";
import { TenantsRepository } from "../../src/modules/tenants/tenants.repository";
import { TenantPostgresProvisioner } from "../../src/providers/postgres.provider";
import { K8S_CORE_API } from "../../src/providers/kubernetes.provider";

describe("TenantsService", () => {
  let service: TenantsService;
  let repository: {
    findByName: ReturnType<typeof mock>;
    create: ReturnType<typeof mock>;
    findAll: ReturnType<typeof mock>;
    updateConfiguration: ReturnType<typeof mock>;
    deleteByName: ReturnType<typeof mock>;
  };
  let k8sApi: {
    createNamespace: ReturnType<typeof mock>;
    listNamespace: ReturnType<typeof mock>;
    deleteNamespace: ReturnType<typeof mock>;
  };
  let provisioner: {
    provision: ReturnType<typeof mock>;
    waitForReady: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    repository = {
      findByName: mock(() => Promise.resolve(null)),
      create: mock(() =>
        Promise.resolve({
          name: "tenant-a",
          configuration: {},
          created_at: new Date(),
          updated_at: new Date(),
        }),
      ),
      findAll: mock(() =>
        Promise.resolve([{ name: "tenant-a", configuration: {} }]),
      ),
      updateConfiguration: mock(() =>
        Promise.resolve({
          name: "tenant-a",
          configuration: { yFlowUrl: "https://flow" },
          created_at: new Date(),
          updated_at: new Date(),
        }),
      ),
      deleteByName: mock(() => Promise.resolve(true)),
    };

    k8sApi = {
      createNamespace: mock(() =>
        Promise.resolve({ status: { phase: "Active" } }),
      ),
      listNamespace: mock(() => Promise.resolve({ items: [] })),
      deleteNamespace: mock(() => Promise.resolve({})),
    };

    provisioner = {
      provision: mock(() => Promise.resolve()),
      waitForReady: mock(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: K8S_CORE_API, useValue: k8sApi },
        { provide: TenantPostgresProvisioner, useValue: provisioner },
        { provide: TenantsRepository, useValue: repository },
      ],
    }).compile();

    service = moduleRef.get(TenantsService);
  });

  it("creates tenant and provisions postgres", async () => {
    const created = await service.createTenant("tenant-a", {});
    expect(created.name).toBe("tenant-a");
    expect(provisioner.provision).toHaveBeenCalledTimes(1);
    expect(provisioner.waitForReady).toHaveBeenCalledTimes(1);
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
    expect(rows[0]?.environment).toBe("dev");
  });

  it("getTenant returns detail when tenant exists", async () => {
    repository.findByName.mockResolvedValueOnce({
      name: "tenant-a",
      configuration: {},
      created_at: new Date("2024-01-01"),
      updated_at: new Date("2024-01-02"),
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    const detail = await service.getTenant("tenant-a");
    expect(detail.name).toBe("tenant-a");
    expect(detail.namespaces).toHaveLength(1);
    expect(detail.namespaces[0]?.phase).toBe("Active");
  });

  it("updateTenant returns detail when configuration updates", async () => {
    repository.updateConfiguration.mockResolvedValueOnce({
      name: "tenant-a",
      configuration: { yFlowUrl: "https://flow.example" },
      created_at: new Date(),
      updated_at: new Date(),
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    const detail = await service.updateTenant("tenant-a", {
      yFlowUrl: "https://flow.example",
    });
    expect(detail.configuration).toEqual({ yFlowUrl: "https://flow.example" });
  });

  it("deleteTenant deletes namespaces and repository row", async () => {
    repository.findByName.mockResolvedValueOnce({
      name: "tenant-a",
      configuration: {},
      created_at: new Date(),
      updated_at: new Date(),
    });
    k8sApi.listNamespace.mockResolvedValueOnce({ items: [mockNamespace] });
    await service.deleteTenant("tenant-a");
    expect(k8sApi.deleteNamespace).toHaveBeenCalled();
    expect(repository.deleteByName).toHaveBeenCalledWith("tenant-a");
  });
});
