import { describe, it, expect, mock } from "bun:test";
import { Test } from "@nestjs/testing";
import { createQueuedSql } from "@yoizen/testing";
import {
  AdaptersRepository,
  mapAdapter,
  mapEndpoint,
  type IAdapterRow,
  type IEndpointRow,
} from "../../src/modules/adapters/adapters.repository";
import { POSTGRES_SQL } from "../../src/providers/postgres.provider";
import { makeSqlTestDouble } from "../make-sql-mock";

async function createAdaptersRepository(
  sql: ReturnType<typeof makeSqlTestDouble>,
): Promise<AdaptersRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AdaptersRepository,
      { provide: POSTGRES_SQL, useValue: sql },
    ],
  }).compile();
  return moduleRef.get(AdaptersRepository);
}

describe("mapAdapter / mapEndpoint", () => {
  it("maps adapter row with object JSONB fields", () => {
    const row: IAdapterRow = {
      id: "a1",
      tenant_id: "t1",
      name: "n",
      context: "internal",
      base_url: "https://x",
      auth_type: "none",
      auth_config: { k: "v" },
      headers: [{ key: "h", value: "1" }],
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
    const m = mapAdapter(row);
    expect(m.tenantId).toBe("t1");
    expect(m.authConfig).toEqual({ k: "v" });
    expect(m.headers).toEqual([{ key: "h", value: "1" }]);
    expect(m.isEncrypted).toBe(false);
    expect(m.managedBy).toBeNull();
  });

  it("parses string JSONB auth_config and headers", () => {
    const row: IAdapterRow = {
      id: "a1",
      tenant_id: "t1",
      name: "n",
      context: "external",
      base_url: "u",
      auth_type: "none",
      auth_config: '{"x":1}' as unknown as Record<string, unknown>,
      headers: "[]" as unknown as Array<{ key: string; value: string }>,
      timeout_ms: 1,
      max_retries: 1,
      retry_backoff_ms: 1,
      health_check_path: "/",
      is_encrypted: false,
      tags: [],
      status: "disabled",
      managed_by: "registry-service",
      created_at: "c",
      updated_at: "u",
    };
    const m = mapAdapter(row);
    expect(m.authConfig).toEqual({ x: 1 });
    expect(m.headers).toEqual([]);
    expect(m.managedBy).toBe("registry-service");
  });

  it("maps endpoint row", () => {
    const row: IEndpointRow = {
      id: "e1",
      adapter_id: "a1",
      label: "l",
      method: "GET",
      path: "/p",
      created_at: "c",
    };
    expect(mapEndpoint(row).adapterId).toBe("a1");
  });
});

describe("AdaptersRepository", () => {
  it("isUniqueViolation delegates to postgres helper", async () => {
    const repo = await createAdaptersRepository(
      makeSqlTestDouble(() => Promise.resolve([])),
    );
    expect(repo.isUniqueViolation({ code: "23505" })).toBe(true);
    expect(repo.isUniqueViolation(new Error("other"))).toBe(false);
  });

  it("listEndpointsForAdapters returns empty when no ids", async () => {
    const repo = await createAdaptersRepository(
      makeSqlTestDouble(() => Promise.resolve([])),
    );
    const out = await repo.listEndpointsForAdapters([]);
    expect(out).toEqual([]);
  });

  it("getAdapterRow returns null when query returns no row", async () => {
    const sql = makeSqlTestDouble(() => Promise.resolve([]));
    const r = await createAdaptersRepository(sql);
    const row = await r.getAdapterRow("t1", "missing");
    expect(row).toBeNull();
  });

  it("adapterExists returns false when no row", async () => {
    const sql = makeSqlTestDouble(() => Promise.resolve([]));
    const r = await createAdaptersRepository(sql);
    expect(await r.adapterExists("t1", "x")).toBe(false);
  });

  describe("upsertMirror", () => {
    function baseRow(overrides: Partial<IAdapterRow> = {}): IAdapterRow {
      return {
        id: "a1",
        tenant_id: "t1",
        name: "svc-1",
        context: "internal",
        base_url: "http://old",
        auth_type: "none",
        auth_config: {},
        headers: [],
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

    it("inserts when no existing row is found", async () => {
      const queue: unknown[][] = [[], [baseRow({ base_url: "http://new" })]];
      const sql = createQueuedSql(queue, mock);
      const repo = await createAdaptersRepository(
        sql as unknown as ReturnType<typeof makeSqlTestDouble>,
      );

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

    it("updates existing row when same managed_by", async () => {
      const existing = baseRow({ base_url: "http://old" });
      const queue: unknown[][] = [
        [existing],
        [baseRow({ base_url: "http://new" })],
      ];
      const sql = createQueuedSql(queue, mock);
      const repo = await createAdaptersRepository(
        sql as unknown as ReturnType<typeof makeSqlTestDouble>,
      );

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
      const existing = baseRow({ managed_by: "operator-ui" });
      const queue: unknown[][] = [[existing]];
      const sql = createQueuedSql(queue, mock);
      const repo = await createAdaptersRepository(
        sql as unknown as ReturnType<typeof makeSqlTestDouble>,
      );

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

    it("takes over unmanaged existing row (managed_by null)", async () => {
      const existing = baseRow({ managed_by: null });
      const queue: unknown[][] = [
        [existing],
        [baseRow({ managed_by: "registry-service" })],
      ];
      const sql = createQueuedSql(queue, mock);
      const repo = await createAdaptersRepository(
        sql as unknown as ReturnType<typeof makeSqlTestDouble>,
      );

      const row = await repo.upsertMirror({
        tenantId: "t1",
        serviceName: "svc-1",
        baseUrl: "http://new",
        healthCheckPath: "/health",
        status: "enabled",
        managedBy: "registry-service",
      });
      expect(row.managed_by).toBe("registry-service");
    });
  });

  describe("deleteMirrorByServiceName", () => {
    it("returns count from sql result", async () => {
      const sql = makeSqlTestDouble(() =>
        Promise.resolve(Object.assign([], { count: 1 }) as unknown),
      );
      const repo = await createAdaptersRepository(sql);
      const n = await repo.deleteMirrorByServiceName(
        "t1",
        "svc-1",
        "registry-service",
      );
      expect(n).toBe(1);
    });
  });
});
