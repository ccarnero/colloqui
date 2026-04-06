import { describe, it, expect } from "bun:test";
import { Test } from "@nestjs/testing";
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
      status: "enabled",
      created_at: "c",
      updated_at: "u",
    };
    const m = mapAdapter(row);
    expect(m.tenantId).toBe("t1");
    expect(m.authConfig).toEqual({ k: "v" });
    expect(m.headers).toEqual([{ key: "h", value: "1" }]);
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
      status: "disabled",
      created_at: "c",
      updated_at: "u",
    };
    const m = mapAdapter(row);
    expect(m.authConfig).toEqual({ x: 1 });
    expect(m.headers).toEqual([]);
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
});
