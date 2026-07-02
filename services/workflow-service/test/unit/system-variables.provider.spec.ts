import "reflect-metadata";
import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

let SystemVariablesProvider: typeof import("../../src/modules/workflows/system-variables.provider").SystemVariablesProvider;

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
    "../../src/modules/workflows/system-variables.provider"
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

describe("SystemVariablesProvider", () => {
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
    // agent-admin-service writes values via JSON.stringify(...)::jsonb; some
    // driver configurations return the jsonb column as its raw JSON text.
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
    // First call — hits DB
    const first = await ctx.provider.loadForTenant("tenant-1");
    expect(first).toEqual({ flag: true });
    expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);

    // Second call — should return cached value
    ctx.setRows([{ name: "flag", value: false }]); // change rows to prove cache is used
    const second = await ctx.provider.loadForTenant("tenant-1");
    expect(second).toEqual({ flag: true }); // still the cached value
    expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1); // no additional call
  });

  it("different tenants get different cached values", async () => {
    // Load tenant-A
    ctx.setRows([{ name: "env", value: "production" }]);
    const resultA = await ctx.provider.loadForTenant("tenant-a");
    expect(resultA).toEqual({ env: "production" });

    // Load tenant-B
    ctx.setRows([{ name: "env", value: "staging" }]);
    const resultB = await ctx.provider.loadForTenant("tenant-b");
    expect(resultB).toEqual({ env: "staging" });

    // Both should be independently cached
    expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(2);

    // Re-fetch tenant-A — should return cached production value
    ctx.setRows([{ name: "env", value: "changed" }]);
    const reFetchA = await ctx.provider.loadForTenant("tenant-a");
    expect(reFetchA).toEqual({ env: "production" });

    // Re-fetch tenant-B — should return cached staging value
    const reFetchB = await ctx.provider.loadForTenant("tenant-b");
    expect(reFetchB).toEqual({ env: "staging" });
  });

  it("cache expires after TTL (5 minutes)", async () => {
    ctx.setRows([{ name: "version", value: "v1" }]);
    const originalNow = Date.now;
    let currentTime = originalNow();

    // Override Date.now to control time
    Date.now = () => currentTime;

    try {
      // First call — caches with timestamp
      const first = await ctx.provider.loadForTenant("tenant-1");
      expect(first).toEqual({ version: "v1" });
      expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);

      // Advance time by 4 minutes 59 seconds — cache should still be valid
      currentTime += 4 * 60 * 1000 + 59 * 1000;
      ctx.setRows([{ name: "version", value: "v2" }]);
      const cached = await ctx.provider.loadForTenant("tenant-1");
      expect(cached).toEqual({ version: "v1" }); // still cached
      expect(ctx.mocks.ensureSchema).toHaveBeenCalledTimes(1);

      // Advance past 5-minute TTL
      currentTime += 2 * 1000; // total: ~5 min 1 sec
      ctx.setRows([{ name: "version", value: "v3" }]);
      const expired = await ctx.provider.loadForTenant("tenant-1");
      expect(expired).toEqual({ version: "v3" }); // refreshed from DB
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
