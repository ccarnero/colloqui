import "reflect-metadata";
import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

let SystemVariablesProvider: typeof import("../../src/modules/chat/system-variables.provider").SystemVariablesProvider;

beforeAll(async () => {
  // Mock the provider module's dependencies so the import doesn't cascade
  // into NestJS/database packages that fail outside a full DI container.
  mock.module("../../src/providers/providers.module", () => ({
    SYSTEM_VARIABLES_PG: Symbol("SYSTEM_VARIABLES_PG"),
  }));
  mock.module("@yoizen/database", () => ({
    TenantConnectionManager: class {},
  }));
  ({ SystemVariablesProvider } = await import(
    "../../src/modules/chat/system-variables.provider"
  ));
});

/**
 * Creates a fresh SystemVariablesProvider with a mocked TenantConnectionManager.
 * The mock `pg.ensureSchema(tenantId)` returns a tagged-template SQL function
 * that resolves with the rows configured via `setRows()`.
 */
function createProvider() {
  let rows: Array<{ name: string; value: unknown }> = [];

  const sqlFn = mock((_strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(rows)
  );

  const ensureSchema = mock(() => Promise.resolve(sqlFn));

  const mockPg = { ensureSchema };

  const provider = new SystemVariablesProvider(mockPg as unknown as never);

  return {
    provider,
    mocks: { ensureSchema, sqlFn },
    setRows: (r: Array<{ name: string; value: unknown }>) => {
      rows = r;
    },
  };
}

describe("SystemVariablesProvider (agent-ai-service)", () => {
  let ctx: ReturnType<typeof createProvider>;

  beforeEach(() => {
    ctx = createProvider();
  });

  it("returns empty object when no system variables exist", async () => {
    ctx.setRows([]);
    const result = await ctx.provider.loadForTenant("tenant-1");
    expect(result).toEqual({});
    expect(ctx.mocks.ensureSchema).toHaveBeenCalledWith("tenant-1");
  });

  it("returns the correct system variables from DB", async () => {
    ctx.setRows([
      { name: "companyName", value: "Yoizen Corp" },
      { name: "region", value: "LATAM" },
      { name: "maxRetries", value: 3 },
    ]);
    const result = await ctx.provider.loadForTenant("tenant-1");
    expect(result).toEqual({
      companyName: "Yoizen Corp",
      region: "LATAM",
      maxRetries: 3,
    });
  });

  it("parses jsonb values returned as raw JSON text by the pg driver", async () => {
    ctx.setRows([
      { name: "companyName", value: '"Acme Telco"' },
      { name: "maxRetries", value: "3" },
      { name: "flag", value: "true" },
      { name: "settings", value: '{"tier":"gold"}' },
      { name: "plainText", value: "not json at all" },
    ]);
    const result = await ctx.provider.loadForTenant("tenant-1");
    expect(result).toEqual({
      companyName: "Acme Telco",
      maxRetries: 3,
      flag: true,
      settings: { tier: "gold" },
      plainText: "not json at all",
    });
  });

  it("caches result per tenant — second call returns cached value without DB query", async () => {
    ctx.setRows([{ name: "flag", value: true }]);
    const first = await ctx.provider.loadForTenant("tenant-1");
    expect(first).toEqual({ flag: true });
    expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);

    ctx.setRows([{ name: "flag", value: false }]);
    const second = await ctx.provider.loadForTenant("tenant-1");
    expect(second).toEqual({ flag: true });
    expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);
  });

  it("different tenants get different cached values", async () => {
    ctx.setRows([{ name: "env", value: "production" }]);
    const resultA = await ctx.provider.loadForTenant("tenant-a");
    expect(resultA).toEqual({ env: "production" });

    ctx.setRows([{ name: "env", value: "staging" }]);
    const resultB = await ctx.provider.loadForTenant("tenant-b");
    expect(resultB).toEqual({ env: "staging" });

    expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(2);

    ctx.setRows([{ name: "env", value: "changed" }]);
    const reFetchA = await ctx.provider.loadForTenant("tenant-a");
    expect(reFetchA).toEqual({ env: "production" });

    const reFetchB = await ctx.provider.loadForTenant("tenant-b");
    expect(reFetchB).toEqual({ env: "staging" });
  });

  it("cache expires after TTL (5 minutes)", async () => {
    ctx.setRows([{ name: "version", value: "v1" }]);
    const originalNow = Date.now;
    let currentTime = originalNow();

    Date.now = () => currentTime;

    try {
      const first = await ctx.provider.loadForTenant("tenant-1");
      expect(first).toEqual({ version: "v1" });
      expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);

      currentTime += 4 * 60 * 1000 + 59 * 1000;
      ctx.setRows([{ name: "version", value: "v2" }]);
      const cached = await ctx.provider.loadForTenant("tenant-1");
      expect(cached).toEqual({ version: "v1" });
      expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);

      currentTime += 2 * 1000;
      ctx.setRows([{ name: "version", value: "v3" }]);
      const expired = await ctx.provider.loadForTenant("tenant-1");
      expect(expired).toEqual({ version: "v3" });
      expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalNow;
    }
  });

  it("throws when DB query fails", async () => {
    ctx.mocks.ensureSchema.mockImplementation(() =>
      Promise.reject(new Error("connection refused"))
    );
    await expect(ctx.provider.loadForTenant("tenant-1")).rejects.toThrow(
      "connection refused"
    );
  });
});
