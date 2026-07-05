import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ServiceEventsPublisher } from "../../src/modules/services/service-events.publisher";
import { ServicesMongoRepository } from "../../src/modules/services/services.mongo.repository";
import { SERVICES_REPOSITORY } from "../../src/modules/services/services.repository.interface";
import { ServicesService } from "../../src/modules/services/services.service";
import { K8S_CUSTOM_OBJECTS_API } from "../../src/providers/kubernetes.provider";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { makeRegistryMongoClient } from "../mongo-mock";

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
  let sqlQueue: unknown[];
  let service: ServicesService;
  let eventsPublisher: {
    publishUpserted: ReturnType<typeof mock>;
    publishDeleted: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    process.env.PLATFORM_ENVIRONMENT = "dev";
    sqlQueue = [];
    const mongo = makeRegistryMongoClient(sqlQueue);
    customApi = {
      createNamespacedCustomObject: mock(() => Promise.resolve({})),
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({
          status: { conditions: [] },
        })
      ),
      replaceNamespacedCustomObject: mock(() => Promise.resolve({})),
      deleteNamespacedCustomObject: mock(() => Promise.resolve({})),
      listNamespacedCustomObject: mock(() => Promise.resolve({ items: [] })),
    };

    eventsPublisher = {
      publishUpserted: mock(() => Promise.resolve()),
      publishDeleted: mock(() => Promise.resolve()),
    };

    const module = await Test.createTestingModule({
      providers: [
        ServicesMongoRepository,
        {
          provide: SERVICES_REPOSITORY,
          useExisting: ServicesMongoRepository,
        },
        ServicesService,
        { provide: K8S_CUSTOM_OBJECTS_API, useValue: customApi },
        { provide: MONGO_CLIENT, useValue: mongo },
        { provide: ServiceEventsPublisher, useValue: eventsPublisher },
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
        })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(customApi.createNamespacedCustomObject).not.toHaveBeenCalled();
    });

    it("throws InternalServerErrorException when Knative create fails", async () => {
      sqlQueue.push([]);
      customApi.createNamespacedCustomObject.mockImplementationOnce(() =>
        Promise.reject(new Error("apiserver timeout"))
      );
      await expect(
        service.register("tenant-a", {
          name: "my-service",
          image: "registry.io/img:v1",
        })
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
        NotFoundException
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
        service.update("tenant-a", "nope", { image: "x:v2" })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("patches Knative and returns updated row", async () => {
      const row = baseRegisteredRow();
      sqlQueue.push(
        [row],
        [
          {
            ...row,
            image: "registry.io/img:v2",
            updated_at: "2020-02-01T00:00:00.000Z",
          },
        ]
      );
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

    it("retries after a 409 conflict, re-applying the mutation to the FRESH re-GET", async () => {
      const row = baseRegisteredRow();
      sqlQueue.push(
        [row],
        [
          {
            ...row,
            image: "registry.io/img:v2",
            updated_at: "2020-02-01T00:00:00.000Z",
          },
        ]
      );

      const staleKsvc = {
        metadata: { resourceVersion: "1" },
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
      };
      const freshKsvc = {
        metadata: { resourceVersion: "2" },
        spec: {
          template: {
            metadata: { annotations: { "reconciler-touched": "true" } },
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
      };

      customApi.getNamespacedCustomObject.mockResolvedValueOnce(staleKsvc);
      customApi.getNamespacedCustomObject.mockResolvedValueOnce(freshKsvc);
      customApi.replaceNamespacedCustomObject.mockRejectedValueOnce({
        response: { statusCode: 409, body: { message: "conflict" } },
      });
      customApi.replaceNamespacedCustomObject.mockResolvedValueOnce({});

      const updated = await service.update("tenant-a", "svc-1", {
        image: "registry.io/img:v2",
      });

      expect(updated.image).toBe("registry.io/img:v2");
      expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(2);
      expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledTimes(2);

      // The generated client-node CustomObjectsApi takes a single param
      // object with a `body` field, so args[0].body is the actual payload.
      const secondReplaceParams = customApi.replaceNamespacedCustomObject.mock
        .calls[1][0] as {
        body: {
          metadata: { resourceVersion: string };
          spec: {
            template: { metadata: { annotations: Record<string, string> } };
          };
        };
      };
      const secondReplaceBody = secondReplaceParams.body;
      // The PUT that finally succeeds must be built from the SECOND
      // (fresh) GET, not the stale first one — proven by resourceVersion
      // and the reconciler-added annotation surviving into the payload.
      expect(secondReplaceBody.metadata.resourceVersion).toBe("2");
      expect(
        secondReplaceBody.spec.template.metadata.annotations[
          "reconciler-touched"
        ]
      ).toBe("true");
    });
  });

  describe("remove", () => {
    it("throws NotFoundException when service missing", async () => {
      sqlQueue.push([]);
      await expect(
        service.remove("tenant-a", "missing")
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("deletes Knative object and DB row", async () => {
      sqlQueue.push([baseRegisteredRow()], []);
      await service.remove("tenant-a", "svc-1");
      expect(customApi.deleteNamespacedCustomObject).toHaveBeenCalled();
    });
  });

  describe("adapter-sync events", () => {
    it("publishes upserted event after register", async () => {
      sqlQueue.push(null);
      const row = await service.register("tenant-a", {
        name: "my-service",
        image: "registry.io/img:v1",
      });
      expect(eventsPublisher.publishUpserted).toHaveBeenCalledTimes(1);
      const [payload] = eventsPublisher.publishUpserted.mock.calls[0];
      expect(payload).toEqual(
        expect.objectContaining({
          serviceId: row.id,
          tenantId: "tenant-a",
          name: "my-service",
          knativeName: "my-service-tenant-a",
          namespace: "tenant-a-dev-ns",
        })
      );
    });

    it("publishes upserted event after update", async () => {
      const row = baseRegisteredRow();
      sqlQueue.push([row], [{ ...row, image: "registry.io/img:v2" }]);
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
      await service.update("tenant-a", "svc-1", {
        image: "registry.io/img:v2",
      });
      expect(eventsPublisher.publishUpserted).toHaveBeenCalledTimes(1);
    });

    it("publishes deleted event after remove", async () => {
      sqlQueue.push([baseRegisteredRow()], []);
      await service.remove("tenant-a", "svc-1");
      expect(eventsPublisher.publishDeleted).toHaveBeenCalledTimes(1);
      const [payload] = eventsPublisher.publishDeleted.mock.calls[0];
      expect(payload).toEqual(
        expect.objectContaining({
          serviceId: "svc-1",
          tenantId: "tenant-a",
          name: "my-service",
        })
      );
    });

    it("does not publish when register fails (knative error)", async () => {
      sqlQueue.push([]);
      customApi.createNamespacedCustomObject.mockImplementationOnce(() =>
        Promise.reject(new Error("boom"))
      );
      await expect(
        service.register("tenant-a", {
          name: "x",
          image: "img",
        })
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(eventsPublisher.publishUpserted).not.toHaveBeenCalled();
    });
  });

  describe("listRevisions", () => {
    it("throws NotFoundException when service row missing", async () => {
      sqlQueue.push([]);
      await expect(
        service.listRevisions("tenant-a", "missing")
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns mapped revisions from Knative list", async () => {
      sqlQueue.push([
        {
          knative_name: "ksvc-1",
          namespace: "tenant-a-dev-ns",
        },
      ]);
      customApi.listNamespacedCustomObject.mockResolvedValueOnce({
        items: [
          {
            metadata: {
              name: "rev-1",
              creationTimestamp: "2020-01-01T00:00:00Z",
            },
            status: {
              conditions: [{ type: "Ready", status: "True" }],
            },
            spec: { containers: [{ image: "img:v1" }] },
          },
        ],
      });
      const revs = await service.listRevisions("tenant-a", "svc-1");
      expect(revs).toHaveLength(1);
      expect(revs[0]?.name).toBe("rev-1");
      expect(revs[0]?.ready).toBe(true);
      expect(revs[0]?.image).toBe("img:v1");
    });

    it("returns empty array when knative fields missing", async () => {
      sqlQueue.push([
        {
          knative_name: null,
          namespace: "ns",
        },
      ]);
      const revs = await service.listRevisions("tenant-a", "svc-1");
      expect(revs).toEqual([]);
    });
  });
});
