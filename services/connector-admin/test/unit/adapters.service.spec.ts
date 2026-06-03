import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Db } from "mongodb";
import { AdaptersMongoRepository } from "../../src/modules/adapters/adapters.mongo.repository";
import { AdaptersService } from "../../src/modules/adapters/adapters.service";
import { ADAPTERS_REPOSITORY } from "../../src/modules/adapters/adapters.repository.interface";
import { AdapterTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import {
  makeFakeTenantMongoConnections,
  makeFindChain,
  makeMockDb,
} from "../make-mongo-mock";
import type {
  CreateAdapterDto,
  CreateEndpointDto,
} from "../../src/modules/adapters/adapters.dto";

async function createAdaptersService(db: Db): Promise<AdaptersService> {
  const connections = makeFakeTenantMongoConnections(db);
  const moduleRef = await Test.createTestingModule({
    providers: [
      AdaptersMongoRepository,
      AdaptersService,
      {
        provide: ADAPTERS_REPOSITORY,
        useExisting: AdaptersMongoRepository,
      },
      { provide: AdapterTenantConnectionManager, useValue: connections },
    ],
  }).compile();
  return moduleRef.get(AdaptersService);
}

const adapterDoc = {
  _id: "a1",
  name: "Adapter One",
  context: "internal",
  base_url: "https://api.example.com",
  auth_type: "none",
  auth_config: {},
  headers: [] as Array<{ key: string; value: string }>,
  default_cache_strategy: null,
  timeout_ms: 5000,
  max_retries: 3,
  retry_backoff_ms: 1000,
  health_check_path: "/health",
  is_encrypted: false,
  tags: [] as string[],
  status: "enabled" as const,
  managed_by: null,
  created_at: new Date("2024-01-01T00:00:00.000Z"),
  updated_at: new Date("2024-01-01T00:00:00.000Z"),
};

const endpointDoc = {
  _id: "e1",
  adapter_id: "a1",
  label: "default",
  method: "GET",
  path: "/v1",
  cache_strategy: null,
  created_at: new Date("2024-01-01T00:00:00.000Z"),
};

describe("AdaptersService", () => {
  const baseDto: CreateAdapterDto = {
    name: "Adapter One",
    context: "internal",
    baseUrl: "https://api.example.com",
  };

  describe("create", () => {
    it("inserts an adapter and maps the result", async () => {
      const db = makeMockDb({
        http_adapters: { insertOne: mock(async () => ({ acknowledged: true })) },
        adapter_endpoints: {},
      });
      const service = await createAdaptersService(db);
      const result = await service.create("t1", baseDto);
      expect(result.name).toBe("Adapter One");
      expect(result.tenantId).toBe("t1");
      expect(result.endpoints).toEqual([]);
    });

    it("maps duplicate key to ConflictException", async () => {
      const db = makeMockDb({
        http_adapters: {
          insertOne: mock(async () => {
            throw Object.assign(new Error("duplicate"), { code: 11000 });
          }),
        },
        adapter_endpoints: {},
      });
      const service = await createAdaptersService(db);
      await expect(service.create("t1", baseDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("list", () => {
    it("returns empty array when no adapters", async () => {
      const db = makeMockDb({
        http_adapters: { find: makeFindChain([]) },
        adapter_endpoints: { find: makeFindChain([]) },
      });
      const service = await createAdaptersService(db);
      const rows = await service.list("t1", undefined, 50, 0);
      expect(rows).toEqual([]);
    });

    it("returns adapters with endpoints", async () => {
      const db = makeMockDb({
        http_adapters: { find: makeFindChain([adapterDoc]) },
        adapter_endpoints: { find: makeFindChain([endpointDoc]) },
      });
      const service = await createAdaptersService(db);
      const rows = await service.list("t1", undefined, 50, 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe("t1");
      expect(rows[0]?.endpoints).toHaveLength(1);
      expect(rows[0]?.endpoints[0]?.path).toBe("/v1");
    });
  });

  describe("get", () => {
    it("throws NotFoundException when adapter missing", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => null) },
        adapter_endpoints: { find: makeFindChain([]) },
      });
      const service = await createAdaptersService(db);
      await expect(service.get("t1", "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns adapter with endpoints", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => adapterDoc) },
        adapter_endpoints: { find: makeFindChain([endpointDoc]) },
      });
      const service = await createAdaptersService(db);
      const row = await service.get("t1", "a1");
      expect(row.id).toBe("a1");
      expect(row.tenantId).toBe("t1");
      expect(row.endpoints).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("throws when adapter does not exist", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => null) },
      });
      const service = await createAdaptersService(db);
      await expect(
        service.update("t1", "a1", { name: "x" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("applies partial update and returns fresh row", async () => {
      const findOne = mock(async () => ({
        ...adapterDoc,
        name: "Renamed",
      }));
      const db = makeMockDb({
        http_adapters: {
          findOne,
          updateOne: mock(async () => ({ modifiedCount: 1 })),
        },
        adapter_endpoints: { find: makeFindChain([]) },
      });
      const service = await createAdaptersService(db);
      const row = await service.update("t1", "a1", { name: "Renamed" });
      expect(row.name).toBe("Renamed");
    });

    it("rejects registry-owned field edits on a managed adapter", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            ...adapterDoc,
            managed_by: "registry-service",
          })),
          updateOne: mock(async () => ({ modifiedCount: 1 })),
        },
      });
      const service = await createAdaptersService(db);
      await expect(
        service.update("t1", "a1", { baseUrl: "https://evil.example.com" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("exposes lockedFields/editableFields in the managed conflict body", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            ...adapterDoc,
            managed_by: "registry-service",
          })),
        },
      });
      const service = await createAdaptersService(db);
      try {
        await service.update("t1", "a1", {
          baseUrl: "https://evil.example.com",
          status: "disabled",
        });
        throw new Error("expected ConflictException");
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          reason: string;
          managedBy: string;
          lockedFields: string[];
          editableFields: string[];
        };
        expect(body.reason).toBe("MANAGED_ADAPTER");
        expect(body.managedBy).toBe("registry-service");
        expect(body.lockedFields).toContain("baseUrl");
        expect(body.lockedFields).toContain("status");
        expect(body.editableFields).toContain("headers");
        expect(body.editableFields).not.toContain("baseUrl");
      }
    });

    it("allows non-registry-owned field edits on a managed adapter", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            ...adapterDoc,
            managed_by: "registry-service",
            timeout_ms: 9000,
          })),
          updateOne: mock(async () => ({ modifiedCount: 1 })),
        },
        adapter_endpoints: { find: makeFindChain([]) },
      });
      const service = await createAdaptersService(db);
      const row = await service.update("t1", "a1", { timeoutMs: 9000 });
      expect(row.timeoutMs).toBe(9000);
    });
  });

  describe("remove", () => {
    it("throws when nothing deleted", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => adapterDoc),
          deleteOne: mock(async () => ({ deletedCount: 0 })),
          deleteMany: mock(async () => ({ deletedCount: 0 })),
        },
        adapter_endpoints: { deleteMany: mock(async () => ({ deletedCount: 0 })) },
      });
      const service = await createAdaptersService(db);
      await expect(service.remove("t1", "a1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("deletes when row exists", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => adapterDoc),
          deleteOne: mock(async () => ({ deletedCount: 1 })),
        },
        adapter_endpoints: { deleteMany: mock(async () => ({ deletedCount: 1 })) },
      });
      const service = await createAdaptersService(db);
      await service.remove("t1", "a1");
    });

    it("throws ConflictException when adapter is managed by registry", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            ...adapterDoc,
            managed_by: "registry-service",
          })),
        },
      });
      const service = await createAdaptersService(db);
      await expect(service.remove("t1", "a1")).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe("addEndpoint", () => {
    const epDto: CreateEndpointDto = {
      label: "Get Users",
      method: "GET",
      path: "/users",
    };

    it("adds an endpoint and returns mapped result", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => adapterDoc) },
        adapter_endpoints: {
          insertOne: mock(async () => ({ acknowledged: true })),
        },
      });
      const service = await createAdaptersService(db);
      const result = await service.addEndpoint("t1", "a1", epDto);
      expect(result.adapterId).toBe("a1");
      expect(result.method).toBe("GET");
      expect(result.path).toBe("/users");
      expect(result.label).toBe("Get Users");
    });

    it("throws NotFoundException when adapter does not exist", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => null) },
      });
      const service = await createAdaptersService(db);
      await expect(
        service.addEndpoint("t1", "missing", epDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows adding an endpoint to a managed adapter", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            ...adapterDoc,
            managed_by: "registry-service",
          })),
        },
        adapter_endpoints: {
          insertOne: mock(async () => ({ acknowledged: true })),
        },
      });
      const service = await createAdaptersService(db);
      const result = await service.addEndpoint("t1", "a1", epDto);
      expect(result.adapterId).toBe("a1");
      expect(result.path).toBe("/users");
    });

    it("throws ConflictException on duplicate endpoint (11000)", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => adapterDoc) },
        adapter_endpoints: {
          insertOne: mock(async () => {
            throw Object.assign(new Error("duplicate"), { code: 11000 });
          }),
        },
      });
      const service = await createAdaptersService(db);
      await expect(
        service.addEndpoint("t1", "a1", epDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("removeEndpoint", () => {
    it("removes an existing endpoint", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => adapterDoc) },
        adapter_endpoints: {
          deleteOne: mock(async () => ({ deletedCount: 1 })),
        },
      });
      const service = await createAdaptersService(db);
      await service.removeEndpoint("t1", "a1", "e1");
    });

    it("throws NotFoundException when adapter does not exist", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => null) },
      });
      const service = await createAdaptersService(db);
      await expect(
        service.removeEndpoint("t1", "missing", "e1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws NotFoundException when endpoint does not exist", async () => {
      const db = makeMockDb({
        http_adapters: { findOne: mock(async () => adapterDoc) },
        adapter_endpoints: {
          deleteOne: mock(async () => ({ deletedCount: 0 })),
        },
      });
      const service = await createAdaptersService(db);
      await expect(
        service.removeEndpoint("t1", "a1", "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows removing an endpoint from a managed adapter", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            ...adapterDoc,
            managed_by: "registry-service",
          })),
        },
        adapter_endpoints: {
          deleteOne: mock(async () => ({ deletedCount: 1 })),
        },
      });
      const service = await createAdaptersService(db);
      await service.removeEndpoint("t1", "a1", "e1");
    });
  });
});
