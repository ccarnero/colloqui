import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import {
  AdaptersMongoRepository,
} from "../../src/modules/adapters/adapters.mongo.repository";
import {
  mapAdapter,
  mapEndpoint,
  type IAdapterRow,
  type IEndpointRow,
} from "../../src/modules/adapters/adapters.repository.interface";
import { AdapterTenantConnectionManager } from "../../src/providers/tenant-connection-manager";
import { makeFakeTenantMongoConnections } from "../make-mongo-mock";
import type { Db } from "mongodb";

async function createAdaptersRepository(db: Db) {
  const connections = makeFakeTenantMongoConnections(db);
  const moduleRef = await Test.createTestingModule({
    providers: [
      AdaptersMongoRepository,
      { provide: AdapterTenantConnectionManager, useValue: connections },
    ],
  }).compile();
  return {
    repo: moduleRef.get(AdaptersMongoRepository),
    connections,
  };
}

function makeMockDb(collections: Record<string, Record<string, unknown>>): Db {
  return {
    collection: mock((name: string) => collections[name] ?? {}),
  } as unknown as Db;
}

describe("mapAdapter / mapEndpoint", () => {
  it("maps adapter row with object JSONB fields", () => {
    const row: IAdapterRow = {
      id: "a1",
      name: "n",
      context: "internal",
      base_url: "https://x",
      auth_type: "none",
      auth_config: { k: "v" },
      headers: [{ key: "h", value: "1" }],
      default_cache_strategy: null,
      timeout_ms: 1000,
      max_retries: 1,
      retry_backoff_ms: 2,
      health_check_path: "/h",
      is_encrypted: false,
      tags: [],
      status: "enabled",
      managed_by: null,
      created_at: "c",
      updated_at: "u",
    };
    const m = mapAdapter(row, "t1");
    expect(m.tenantId).toBe("t1");
    expect(m.authConfig).toEqual({ k: "v" });
  });

  it("maps endpoint row", () => {
    const row: IEndpointRow = {
      id: "e1",
      adapter_id: "a1",
      label: "l",
      method: "GET",
      path: "/p",
      cache_strategy: null,
      created_at: "c",
    };
    expect(mapEndpoint(row).adapterId).toBe("a1");
  });
});

describe("AdaptersMongoRepository", () => {
  it("isUniqueViolation delegates to mongo helper", async () => {
    const db = makeMockDb({});
    const { repo } = await createAdaptersRepository(db);
    expect(repo.isUniqueViolation({ code: 11000 })).toBe(true);
    expect(repo.isUniqueViolation(new Error("other"))).toBe(false);
  });

  it("listEndpointsForAdapters returns empty when no ids", async () => {
    const db = makeMockDb({});
    const { repo } = await createAdaptersRepository(db);
    const out = await repo.listEndpointsForAdapters("t1", []);
    expect(out).toEqual([]);
  });

  it("getAdapterRow returns null when query returns no row", async () => {
    const db = makeMockDb({
      http_adapters: {
        findOne: mock(async () => null),
      },
    });
    const { repo } = await createAdaptersRepository(db);
    const row = await repo.getAdapterRow("t1", "missing");
    expect(row).toBeNull();
  });

  it("adapterExists returns false when no row", async () => {
    const db = makeMockDb({
      http_adapters: {
        findOne: mock(async () => null),
        countDocuments: mock(async () => 0),
      },
    });
    const { repo } = await createAdaptersRepository(db);
    expect(await repo.adapterExists("t1", "x")).toBe(false);
  });

  it("ensureSchema is called on repeated repository calls", async () => {
    const db = makeMockDb({
      http_adapters: {
        findOne: mock(async () => null),
        countDocuments: mock(async () => 0),
      },
    });
    const { repo, connections } = await createAdaptersRepository(db);
    await repo.getAdapterRow("t1", "a");
    await repo.getAdapterRow("t1", "b");
    await repo.adapterExists("t1", "c");
    await repo.getAdapterRow("t2", "a");
    expect(connections.ensureSchemaCalls.get("t1") ?? 0).toBeGreaterThanOrEqual(3);
    expect(connections.ensureSchemaCalls.get("t2") ?? 0).toBe(1);
  });

  describe("upsertMirror", () => {
    function baseRow(overrides: Partial<IAdapterRow> = {}): IAdapterRow {
      return {
        id: "a1",
        name: "svc-1",
        context: "internal",
        base_url: "http://old",
        auth_type: "none",
        auth_config: {},
        headers: [],
        default_cache_strategy: null,
        timeout_ms: 30_000,
        max_retries: 0,
        retry_backoff_ms: 0,
        health_check_path: "/health",
        is_encrypted: false,
        tags: [],
        status: "enabled",
        managed_by: "registry-service",
        created_at: "c",
        updated_at: "u",
        ...overrides,
      };
    }

    it("upserts when no existing row is found", async () => {
      const findOne = mock(async () => null);
      const findOneAndUpdate = mock(async () => ({
        _id: "a1",
        name: "svc-1",
        context: "internal",
        base_url: "http://new",
        auth_type: "none",
        auth_config: {},
        headers: [],
        default_cache_strategy: null,
        timeout_ms: 30_000,
        max_retries: 0,
        retry_backoff_ms: 0,
        health_check_path: "/health",
        is_encrypted: false,
        tags: [],
        status: "enabled",
        managed_by: "registry-service",
        created_at: new Date(),
        updated_at: new Date(),
      }));
      const db = makeMockDb({
        http_adapters: { findOne, findOneAndUpdate },
      });
      const { repo } = await createAdaptersRepository(db);
      const row = await repo.upsertMirror({
        tenantId: "t1",
        serviceName: "svc-1",
        baseUrl: "http://new",
        healthCheckPath: "/health",
        status: "enabled",
        managedBy: "registry-service",
      });
      expect(row.base_url).toBe("http://new");
    });

    it("throws when existing row is managed by a different owner", async () => {
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({
            managed_by: "operator-ui",
          })),
        },
      });
      const { repo } = await createAdaptersRepository(db);
      await expect(
        repo.upsertMirror({
          tenantId: "t1",
          serviceName: "svc-1",
          baseUrl: "http://new",
          healthCheckPath: "/health",
          status: "enabled",
          managedBy: "registry-service",
        }),
      ).rejects.toThrow(/managed by 'operator-ui'/);
    });

    it("updates existing row when same managed_by", async () => {
      const findOneAndUpdate = mock(async () => ({
        _id: "a1",
        name: "svc-1",
        context: "internal",
        base_url: "http://new",
        auth_type: "none",
        auth_config: {},
        headers: [],
        default_cache_strategy: null,
        timeout_ms: 30_000,
        max_retries: 0,
        retry_backoff_ms: 0,
        health_check_path: "/health",
        is_encrypted: false,
        tags: [],
        status: "enabled",
        managed_by: "registry-service",
        created_at: new Date(),
        updated_at: new Date(),
      }));
      const db = makeMockDb({
        http_adapters: {
          findOne: mock(async () => ({ managed_by: "registry-service" })),
          findOneAndUpdate,
        },
      });
      const { repo } = await createAdaptersRepository(db);
      const row = await repo.upsertMirror({
        tenantId: "t1",
        serviceName: "svc-1",
        baseUrl: "http://new",
        healthCheckPath: "/health",
        status: "enabled",
        managedBy: "registry-service",
      });
      expect(row.base_url).toBe("http://new");
    });
  });

  describe("deleteMirrorByServiceName", () => {
    it("returns deleted count", async () => {
      const db = makeMockDb({
        http_adapters: {
          deleteOne: mock(async () => ({ deletedCount: 1 })),
        },
      });
      const { repo } = await createAdaptersRepository(db);
      const n = await repo.deleteMirrorByServiceName(
        "t1",
        "svc-1",
        "registry-service",
      );
      expect(n).toBe(1);
    });
  });
});
