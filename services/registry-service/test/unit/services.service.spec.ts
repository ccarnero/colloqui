import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException, InternalServerErrorException } from "@nestjs/common";
import type { Sql } from "postgres";
import { ServicesService } from "../../src/modules/services/services.service";
import { K8S_CUSTOM_OBJECTS_API } from "../../src/providers/kubernetes.provider";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";

function createQueuedSql(rowsQueue: unknown[][]): Sql {
  const fn = mock(() => {
    const next = rowsQueue.shift();
    return Promise.resolve(next ?? []);
  });
  return Object.assign(fn, {
    json: (v: unknown) => v,
  }) as unknown as Sql;
}

function baseRegisteredRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "svc-1",
    tenant_id: "tenant-a",
    name: "my-service",
    image: "registry.io/img:v1",
    port: 3000,
    min_scale: 0,
    max_scale: 10,
    concurrency_target: 100,
    env_vars: {},
    status: "active",
    knative_name: "my-service-tenant-a",
    namespace: "tenant-a-dev-ns",
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ServicesService", () => {
  let customApi: {
    createNamespacedCustomObject: ReturnType<typeof mock>;
    getNamespacedCustomObject: ReturnType<typeof mock>;
    replaceNamespacedCustomObject: ReturnType<typeof mock>;
    deleteNamespacedCustomObject: ReturnType<typeof mock>;
    listNamespacedCustomObject: ReturnType<typeof mock>;
  };
  let sqlQueue: unknown[][];
  let service: ServicesService;

  beforeEach(async () => {
    process.env.PLATFORM_ENVIRONMENT = "dev";
    sqlQueue = [];
    const sql = createQueuedSql(sqlQueue);
    customApi = {
      createNamespacedCustomObject: mock(() => Promise.resolve({})),
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({
          status: { conditions: [] },
        }),
      ),
      replaceNamespacedCustomObject: mock(() => Promise.resolve({})),
      deleteNamespacedCustomObject: mock(() => Promise.resolve({})),
      listNamespacedCustomObject: mock(() =>
        Promise.resolve({ items: [] }),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: K8S_CUSTOM_OBJECTS_API, useValue: customApi },
        { provide: POSTGRES_SQL, useValue: sql },
      ],
    }).compile();

    service = module.get(ServicesService);
  });

  describe("register", () => {
    it("creates Knative service and persists row", async () => {
      sqlQueue.push([], [baseRegisteredRow()]);
      const row = await service.register("tenant-a", {
        name: "my-service",
        image: "registry.io/img:v1",
      });
      expect(row.name).toBe("my-service");
      expect(row.knativeName).toBe("my-service-tenant-a");
      expect(customApi.createNamespacedCustomObject).toHaveBeenCalled();
    });

    it("throws ConflictException when name already exists", async () => {
      sqlQueue.push([{ id: "existing" }]);
      await expect(
        service.register("tenant-a", {
          name: "dup",
          image: "registry.io/img:v1",
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(customApi.createNamespacedCustomObject).not.toHaveBeenCalled();
    });

    it("throws InternalServerErrorException when Knative create fails", async () => {
      sqlQueue.push([]);
      customApi.createNamespacedCustomObject.mockImplementationOnce(() =>
        Promise.reject(new Error("apiserver timeout")),
      );
      await expect(
        service.register("tenant-a", {
          name: "my-service",
          image: "registry.io/img:v1",
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe("list", () => {
    it("returns mapped services for tenant", async () => {
      sqlQueue.push([
        baseRegisteredRow({ name: "a" }),
        baseRegisteredRow({ id: "2", name: "b" }),
      ]);
      const list = await service.list("tenant-a");
      expect(list).toHaveLength(2);
      expect(list[0].tenantId).toBe("tenant-a");
    });
  });

  describe("get", () => {
    it("throws NotFoundException when id missing", async () => {
      sqlQueue.push([]);
      await expect(service.get("tenant-a", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns service with knative status when ksvc exists", async () => {
      sqlQueue.push([baseRegisteredRow()]);
      const detail = await service.get("tenant-a", "svc-1");
      expect(detail.id).toBe("svc-1");
      expect(detail.knativeStatus).toBeDefined();
      expect(customApi.getNamespacedCustomObject).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("throws NotFoundException when service missing", async () => {
      sqlQueue.push([]);
      await expect(
        service.update("tenant-a", "nope", { image: "x:v2" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("patches Knative and returns updated row", async () => {
      const row = baseRegisteredRow();
      sqlQueue.push([row], [
        {
          ...row,
          image: "registry.io/img:v2",
          updated_at: "2020-02-01T00:00:00.000Z",
        },
      ]);
      customApi.getNamespacedCustomObject.mockResolvedValueOnce({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: {
              containers: [
                {
                  name: "user-container",
                  image: "old",
                  ports: [{ containerPort: 3000, protocol: "TCP" }],
                },
              ],
            },
          },
        },
      });
      const updated = await service.update("tenant-a", "svc-1", {
        image: "registry.io/img:v2",
      });
      expect(updated.image).toBe("registry.io/img:v2");
      expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("throws NotFoundException when service missing", async () => {
      sqlQueue.push([]);
      await expect(service.remove("tenant-a", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("deletes Knative object and DB row", async () => {
      sqlQueue.push([baseRegisteredRow()], []);
      await service.remove("tenant-a", "svc-1");
      expect(customApi.deleteNamespacedCustomObject).toHaveBeenCalled();
    });
  });
});
