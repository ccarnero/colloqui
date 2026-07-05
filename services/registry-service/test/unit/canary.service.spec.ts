import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CanaryMongoRepository } from "../../src/modules/canary/canary.mongo.repository";
import { CANARY_REPOSITORY } from "../../src/modules/canary/canary.repository.interface";
import { CanaryService } from "../../src/modules/canary/canary.service";
import { K8S_CUSTOM_OBJECTS_API } from "../../src/providers/kubernetes.provider";
import { MONGO_CLIENT } from "../../src/providers/mongo.provider";
import { makeRegistryMongoClient } from "../mongo-mock";

function baseServiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "svc-1",
    tenant_id: "tenant-a",
    name: "svc",
    image: "img:v1",
    port: 3000,
    min_scale: 0,
    max_scale: 10,
    concurrency_target: 100,
    env_vars: {},
    status: "active",
    knative_name: "ksvc-1",
    namespace: "ns-1",
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type CanaryPrivate = {
  getCurrentRevision: (
    namespace: string,
    name: string
  ) => Promise<string | null>;
  getLatestRevision: (
    namespace: string,
    name: string
  ) => Promise<string | null>;
  applyTrafficSplit: (params: {
    namespace: string;
    name: string;
    primaryRevision: string;
    primaryPercent: number;
    secondaryRevision: string | null;
    secondaryPercent: number;
  }) => Promise<void>;
};

describe("CanaryService", () => {
  let customApi: {
    getNamespacedCustomObject: ReturnType<typeof mock>;
    replaceNamespacedCustomObject: ReturnType<typeof mock>;
  };
  let sqlQueue: unknown[][];
  let service: CanaryService;

  beforeEach(async () => {
    process.env.PLATFORM_ENVIRONMENT = "dev";
    sqlQueue = [];
    const mongo = makeRegistryMongoClient(sqlQueue);
    customApi = {
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({
          status: {
            traffic: [{ revisionName: "rev-a", percent: 100, tag: "stable" }],
            latestReadyRevisionName: "rev-a",
            latestCreatedRevisionName: "rev-b",
          },
        })
      ),
      replaceNamespacedCustomObject: mock(() => Promise.resolve({})),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CanaryMongoRepository,
        {
          provide: CANARY_REPOSITORY,
          useExisting: CanaryMongoRepository,
        },
        CanaryService,
        { provide: K8S_CUSTOM_OBJECTS_API, useValue: customApi },
        { provide: MONGO_CLIENT, useValue: mongo },
      ],
    }).compile();

    service = moduleRef.get(CanaryService);
  });

  describe("getCurrentRevision", () => {
    it("prefers 100% or stable-tagged traffic target", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockResolvedValueOnce({
        status: {
          traffic: [
            { revisionName: "rev-other", percent: 10, tag: "" },
            { revisionName: "rev-stable", percent: 100, tag: "" },
          ],
        },
      });
      await expect(priv.getCurrentRevision("ns", "ksvc")).resolves.toBe(
        "rev-stable"
      );
    });

    it("falls back to first traffic entry revisionName", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockResolvedValueOnce({
        status: {
          traffic: [{ revisionName: "rev-first", percent: 50, tag: "" }],
        },
      });
      await expect(priv.getCurrentRevision("ns", "ksvc")).resolves.toBe(
        "rev-first"
      );
    });

    it("uses latestReadyRevisionName when traffic is empty", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockResolvedValueOnce({
        status: { latestReadyRevisionName: "rev-ready" },
      });
      await expect(priv.getCurrentRevision("ns", "ksvc")).resolves.toBe(
        "rev-ready"
      );
    });

    it("returns null when K8s get fails", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockRejectedValueOnce(
        new Error("apiserver")
      );
      await expect(priv.getCurrentRevision("ns", "ksvc")).resolves.toBeNull();
    });
  });

  describe("getLatestRevision", () => {
    it("returns latestCreatedRevisionName", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockResolvedValueOnce({
        status: { latestCreatedRevisionName: "rev-new" },
      });
      await expect(priv.getLatestRevision("ns", "ksvc")).resolves.toBe(
        "rev-new"
      );
    });

    it("returns null when K8s get fails", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockRejectedValueOnce(
        new Error("timeout")
      );
      await expect(priv.getLatestRevision("ns", "ksvc")).resolves.toBeNull();
    });
  });

  describe("promote", () => {
    it("applies 100% stable traffic and updates row", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 20,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 100,
            status: "promoted",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-02T00:00:00.000Z",
          },
        ]
      );

      customApi.getNamespacedCustomObject.mockResolvedValue({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
        },
      });

      const result = await service.promote("tenant-a", "svc-1");
      expect(result.status).toBe("promoted");
      expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalled();
    });

    it("throws InternalServerErrorException when traffic split replace fails", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 20,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ]
      );

      customApi.getNamespacedCustomObject.mockResolvedValue({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
        },
      });
      customApi.replaceNamespacedCustomObject.mockRejectedValueOnce({
        response: { body: { message: "conflict" } },
      });

      await expect(service.promote("tenant-a", "svc-1")).rejects.toBeInstanceOf(
        InternalServerErrorException
      );
    });
  });

  describe("rollback", () => {
    it("routes 100% to stable revision", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 20,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 0,
            status: "rolled_back",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-02T00:00:00.000Z",
          },
        ]
      );

      customApi.getNamespacedCustomObject.mockResolvedValue({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
        },
      });

      const result = await service.rollback("tenant-a", "svc-1");
      expect(result.status).toBe("rolled_back");
      expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalled();
    });
  });

  describe("updatePercent (traffic split)", () => {
    it("updates canary percent via applyTrafficSplit and DB", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 10,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 40,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-02T00:00:00.000Z",
          },
        ]
      );

      customApi.getNamespacedCustomObject.mockResolvedValue({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
        },
      });

      const result = await service.updatePercent("tenant-a", "svc-1", {
        percent: 40,
      });
      expect(result.canaryPercent).toBe(40);
      expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalled();
    });

    it("resolves Mongo _id when updating canary percent", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            _id: "canary-mongo-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 10,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ],
        [
          {
            _id: "canary-mongo-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 50,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-02T00:00:00.000Z",
          },
        ]
      );

      customApi.getNamespacedCustomObject.mockResolvedValue({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
        },
      });

      const result = await service.updatePercent("tenant-a", "svc-1", {
        percent: 50,
      });
      expect(result.id).toBe("canary-mongo-1");
      expect(result.canaryPercent).toBe(50);
    });
  });

  describe("K8s error handling", () => {
    it("applyTrafficSplit surfaces replace failure", async () => {
      const priv = service as unknown as CanaryPrivate;
      customApi.getNamespacedCustomObject.mockResolvedValue({
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
        },
      });
      customApi.replaceNamespacedCustomObject.mockRejectedValueOnce(
        new Error("network")
      );

      await expect(
        priv.applyTrafficSplit({
          namespace: "ns",
          name: "ksvc",
          primaryRevision: "r1",
          primaryPercent: 100,
          secondaryRevision: null,
          secondaryPercent: 0,
        })
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it("applyTrafficSplit retries after a 409 conflict, re-applying traffic to the FRESH re-GET", async () => {
      const priv = service as unknown as CanaryPrivate;

      const staleKsvc = {
        metadata: { resourceVersion: "1" },
        spec: {
          template: {
            metadata: { annotations: {} },
            spec: { containers: [{ image: "x" }] },
          },
          traffic: [],
        },
      };
      const freshKsvc = {
        metadata: { resourceVersion: "2" },
        spec: {
          template: {
            metadata: { annotations: { "reconciler-touched": "true" } },
            spec: { containers: [{ image: "x" }] },
          },
          traffic: [],
        },
      };

      customApi.getNamespacedCustomObject.mockResolvedValueOnce(staleKsvc);
      customApi.getNamespacedCustomObject.mockResolvedValueOnce(freshKsvc);
      customApi.replaceNamespacedCustomObject.mockRejectedValueOnce({
        response: { statusCode: 409, body: { message: "conflict" } },
      });
      customApi.replaceNamespacedCustomObject.mockResolvedValueOnce({});

      await priv.applyTrafficSplit({
        namespace: "ns",
        name: "ksvc",
        primaryRevision: "rev-stable",
        primaryPercent: 100,
        secondaryRevision: null,
        secondaryPercent: 0,
      });

      expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(2);
      expect(customApi.replaceNamespacedCustomObject).toHaveBeenCalledTimes(2);

      const secondReplaceParams = customApi.replaceNamespacedCustomObject.mock
        .calls[1][0] as {
        body: {
          metadata: { resourceVersion: string };
          spec: {
            template: { metadata: { annotations: Record<string, string> } };
            traffic: Array<{ revisionName: string; percent: number }>;
          };
        };
      };
      const secondBody = secondReplaceParams.body;
      // Proves the retry re-GETs and re-applies the traffic mutation onto
      // the FRESH object (resourceVersion "2"), not the stale first read.
      expect(secondBody.metadata.resourceVersion).toBe("2");
      expect(
        secondBody.spec.template.metadata.annotations["reconciler-touched"]
      ).toBe("true");
      expect(secondBody.spec.traffic).toEqual([
        { revisionName: "rev-stable", percent: 100, tag: "stable" },
      ]);
    });
  });

  describe("guards", () => {
    it("throws NotFoundException when service missing on promote", async () => {
      sqlQueue.push([]);
      await expect(
        service.promote("tenant-a", "missing")
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException when no active canary", async () => {
      sqlQueue.push([baseServiceRow()], []);
      await expect(service.promote("tenant-a", "svc-1")).rejects.toBeInstanceOf(
        NotFoundException
      );
    });
  });

  describe("getStatus", () => {
    it("returns mapped canary when a row exists", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            id: "canary-1",
            service_id: "svc-1",
            stable_revision: "rev-s",
            canary_revision: "rev-c",
            canary_percent: 25,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ]
      );
      const status = await service.getStatus("tenant-a", "svc-1");
      expect(status).not.toBeNull();
      expect(status?.canaryPercent).toBe(25);
      expect(status?.status).toBe("progressing");
    });

    it("returns null when no canary row", async () => {
      sqlQueue.push([baseServiceRow()], []);
      const status = await service.getStatus("tenant-a", "svc-1");
      expect(status).toBeNull();
    });
  });

  describe("start", () => {
    it("throws BadRequestException when a progressing canary already exists", async () => {
      sqlQueue.push(
        [baseServiceRow()],
        [
          {
            id: "c1",
            service_id: "svc-1",
            stable_revision: "a",
            canary_revision: "b",
            canary_percent: 10,
            status: "progressing",
            created_at: "2020-01-01T00:00:00.000Z",
            updated_at: "2020-01-01T00:00:00.000Z",
          },
        ]
      );
      await expect(
        service.start("tenant-a", "svc-1", {
          percent: 10,
          image: "img:v2",
        })
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
