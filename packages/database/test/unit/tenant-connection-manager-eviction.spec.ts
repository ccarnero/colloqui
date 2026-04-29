import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TenantConnectionManager } from "../../src/tenant-connection-manager";

/**
 * The eviction logic operates over the protected `pools` map and the
 * bookkeeping sets. We don't want to spin up real Postgres connections,
 * so every test seeds a fake pool whose tagged-template invocation is
 * controlled by `setQueryResult`. This lets us assert on:
 *
 *   1. `evictTenant` removes the right pool flavours and clears the
 *      bookkeeping state without touching unrelated tenants.
 *   2. `verifyConnectivity` self-heals broken pools whose `SELECT 1`
 *      throws a fatal error (e.g. database/role dropped).
 *   3. `verifyConnectivity` keeps transient-error pools (e.g. ECONNREFUSED)
 *      so a brief outage does NOT wipe the cache.
 */

interface IFakePool {
  end: ReturnType<typeof mock>;
  setQueryResult: (result: "ok" | "fatal" | "transient") => void;
}

function makeFakePool(): IFakePool {
  let mode: "ok" | "fatal" | "transient" = "ok";
  const fn = (() => {
    if (mode === "ok") return Promise.resolve([{ "?column?": 1 }]);
    if (mode === "fatal") {
      return Promise.reject(
        Object.assign(new Error('database "tenant_acme" does not exist'), {
          code: "3D000",
        }),
      );
    }
    return Promise.reject(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), {
        code: "ECONNREFUSED",
      }),
    );
  }) as ((..._args: unknown[]) => Promise<unknown>) & IFakePool;
  fn.end = mock(() => Promise.resolve());
  fn.setQueryResult = (m: "ok" | "fatal" | "transient") => {
    mode = m;
  };
  return fn as unknown as IFakePool;
}

interface IPrivateManager {
  pools: Map<string, IFakePool>;
  initialized: Set<string>;
  pendingSchemaInit: Map<string, Promise<void>>;
  knownTenantIds: Set<string>;
  tierCache: Map<string, string>;
  namespaceInitialized: Map<string, Set<string>>;
}

function asPrivate(mgr: TenantConnectionManager): IPrivateManager {
  return mgr as unknown as IPrivateManager;
}

describe("TenantConnectionManager.evictTenant", () => {
  beforeEach(() => {
    process.env.POSTGRES_PASSWORD = "test-password";
  });
  afterEach(() => {
    delete process.env.POSTGRES_PASSWORD;
  });

  it("evicts shared-tenant and dedicated pools belonging to the tenant", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    const acmeShared = makeFakePool();
    const acmeDedicated = makeFakePool();
    const otherTenant = makeFakePool();
    const sharedSingle = makeFakePool();

    priv.pools.set("shared-tenant:acme:tenant_acme:tenant_acme_app", acmeShared);
    priv.pools.set("dedicated:acme:postgres", acmeDedicated);
    priv.pools.set("shared-tenant:globex:tenant_globex:tenant_globex_app", otherTenant);
    priv.pools.set(
      "shared-single:postgres-shared.dev.svc:yoizen_usage:yoizen",
      sharedSingle,
    );
    priv.initialized.add("shared-tenant:acme:tenant_acme");
    priv.initialized.add("dedicated:acme:yoizen");
    priv.initialized.add("shared-tenant:globex:tenant_globex");
    priv.knownTenantIds.add("acme");
    priv.knownTenantIds.add("globex");
    priv.tierCache.set("acme", "shared");
    priv.tierCache.set("globex", "shared");

    await mgr.evictTenant("acme");

    expect(priv.pools.has("shared-tenant:acme:tenant_acme:tenant_acme_app")).toBe(false);
    expect(priv.pools.has("dedicated:acme:postgres")).toBe(false);
    expect(priv.pools.has("shared-tenant:globex:tenant_globex:tenant_globex_app")).toBe(true);
    expect(priv.pools.has("shared-single:postgres-shared.dev.svc:yoizen_usage:yoizen")).toBe(
      true,
    );

    expect(priv.initialized.has("shared-tenant:acme:tenant_acme")).toBe(false);
    expect(priv.initialized.has("dedicated:acme:yoizen")).toBe(false);
    expect(priv.initialized.has("shared-tenant:globex:tenant_globex")).toBe(true);

    expect(priv.knownTenantIds.has("acme")).toBe(false);
    expect(priv.knownTenantIds.has("globex")).toBe(true);
    expect(priv.tierCache.has("acme")).toBe(false);
    expect(priv.tierCache.has("globex")).toBe(true);

    expect((acmeShared.end as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((acmeDedicated.end as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect((otherTenant.end as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect((sharedSingle.end as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("is idempotent on second call (no double end, no throw)", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    const acmeShared = makeFakePool();
    priv.pools.set("shared-tenant:acme:tenant_acme:tenant_acme_app", acmeShared);

    await mgr.evictTenant("acme");
    await mgr.evictTenant("acme");

    expect((acmeShared.end as ReturnType<typeof mock>).mock.calls.length).toBe(1);
    expect(priv.pools.size).toBe(0);
  });

  it("swallows pool.end() failures so partial cleanup never throws", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    const acmeShared = makeFakePool();
    acmeShared.end = mock(() => Promise.reject(new Error("hung")));
    priv.pools.set("shared-tenant:acme:tenant_acme:tenant_acme_app", acmeShared);

    await expect(mgr.evictTenant("acme")).resolves.toBeUndefined();
    expect(priv.pools.has("shared-tenant:acme:tenant_acme:tenant_acme_app")).toBe(false);
  });

  /**
   * Regression for the second-run dedicated-tenant 500: external callers
   * (audit-service, metrics-service) record initialization with the bare
   * tenant slug via {@link markInitialized}. If `evictTenant` only scrubbed
   * prefix-matching schemaKeys, the bare slug would survive the eviction
   * and short-circuit the next request's `ensureTenantSchemaOnce` guard,
   * skipping the catalog tier re-resolution and routing a dedicated tenant
   * at the shared CNPG cluster (auth fails on `tenant_<id>_app`).
   */
  it("clears the bare tenantId init marker so post-recreate ensureSchema runs again", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    mgr.markInitialized("test-dedicated-tenant");
    mgr.markInitialized("globex");

    expect(mgr.isInitialized("test-dedicated-tenant")).toBe(true);

    await mgr.evictTenant("test-dedicated-tenant");

    expect(mgr.isInitialized("test-dedicated-tenant")).toBe(false);
    expect(priv.initialized.has("test-dedicated-tenant")).toBe(false);
    expect(mgr.isInitialized("globex")).toBe(true);
  });

  /**
   * The (namespace, tenantId) flag used by `ensureTenantNamespaceOnce`
   * MUST be scrubbed on eviction for the same reason: a stale flag would
   * skip the namespace DDL re-init AND the catalog tier re-resolution
   * triggered by the inner `ensureSchema` call.
   */
  it("clears namespace-init markers per tenant and removes the bucket once empty", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    mgr.markNamespaceInitialized("gateway_audit", "test-dedicated-tenant");
    mgr.markNamespaceInitialized("gateway_audit", "globex");
    mgr.markNamespaceInitialized("channel_events", "test-dedicated-tenant");

    expect(mgr.isNamespaceInitialized("gateway_audit", "test-dedicated-tenant")).toBe(true);
    expect(mgr.isNamespaceInitialized("channel_events", "test-dedicated-tenant")).toBe(true);

    await mgr.evictTenant("test-dedicated-tenant");

    expect(mgr.isNamespaceInitialized("gateway_audit", "test-dedicated-tenant")).toBe(false);
    expect(mgr.isNamespaceInitialized("channel_events", "test-dedicated-tenant")).toBe(false);
    expect(mgr.isNamespaceInitialized("gateway_audit", "globex")).toBe(true);
    // Bucket with no remaining tenants is reclaimed.
    expect(priv.namespaceInitialized.has("channel_events")).toBe(false);
    expect(priv.namespaceInitialized.has("gateway_audit")).toBe(true);
  });
});

describe("TenantConnectionManager namespace-init API", () => {
  beforeEach(() => {
    process.env.POSTGRES_PASSWORD = "test-password";
  });
  afterEach(() => {
    delete process.env.POSTGRES_PASSWORD;
  });

  it("returns false for an unmarked (namespace, tenantId) and true once marked", () => {
    const mgr = new TenantConnectionManager();
    expect(mgr.isNamespaceInitialized("gateway_audit", "acme")).toBe(false);
    mgr.markNamespaceInitialized("gateway_audit", "acme");
    expect(mgr.isNamespaceInitialized("gateway_audit", "acme")).toBe(true);
  });

  it("isolates init state across namespaces for the same tenant", () => {
    const mgr = new TenantConnectionManager();
    mgr.markNamespaceInitialized("gateway_audit", "acme");
    expect(mgr.isNamespaceInitialized("gateway_audit", "acme")).toBe(true);
    expect(mgr.isNamespaceInitialized("channel_events", "acme")).toBe(false);
  });
});

describe("TenantConnectionManager.verifyConnectivity self-heal", () => {
  beforeEach(() => {
    process.env.POSTGRES_PASSWORD = "test-password";
  });
  afterEach(() => {
    delete process.env.POSTGRES_PASSWORD;
  });

  it("returns true when no pools are cached (cold start)", async () => {
    const mgr = new TenantConnectionManager();
    expect(await mgr.verifyConnectivity()).toBe(true);
  });

  it("evicts pools whose SELECT 1 throws a fatal error and returns true (cold-start path)", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    const broken = makeFakePool();
    broken.setQueryResult("fatal");
    priv.pools.set("shared-tenant:acme:tenant_acme:tenant_acme_app", broken);
    priv.initialized.add("shared-tenant:acme:tenant_acme:tenant_acme_app");

    const ok = await mgr.verifyConnectivity();

    expect(ok).toBe(false);
    expect(priv.pools.size).toBe(0);
    expect(priv.initialized.size).toBe(0);
    expect((broken.end as ReturnType<typeof mock>).mock.calls.length).toBe(1);

    expect(await mgr.verifyConnectivity()).toBe(true);
  });

  it("keeps pools whose SELECT 1 throws a transient error so the cache is not wiped", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    const transient = makeFakePool();
    transient.setQueryResult("transient");
    priv.pools.set("shared-tenant:acme:tenant_acme:tenant_acme_app", transient);

    const ok = await mgr.verifyConnectivity();

    expect(ok).toBe(false);
    expect(priv.pools.size).toBe(1);
    expect((transient.end as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("returns true when at least one pool answers, ignoring fatal-error siblings", async () => {
    const mgr = new TenantConnectionManager();
    const priv = asPrivate(mgr);
    const broken = makeFakePool();
    broken.setQueryResult("fatal");
    const healthy = makeFakePool();
    healthy.setQueryResult("ok");
    priv.pools.set("shared-tenant:acme:tenant_acme:tenant_acme_app", broken);
    priv.pools.set("shared-tenant:globex:tenant_globex:tenant_globex_app", healthy);

    const ok = await mgr.verifyConnectivity();

    expect(ok).toBe(true);
    expect(priv.pools.has("shared-tenant:acme:tenant_acme:tenant_acme_app")).toBe(false);
    expect(priv.pools.has("shared-tenant:globex:tenant_globex:tenant_globex_app")).toBe(true);
  });
});

/**
 * Hung-pool regression suite: a half-open TCP connection (e.g. a
 * dedicated tenant whose namespace was just torn down) leaves the
 * pool's `SELECT 1` pending forever. Without a per-probe timeout the
 * serial pre-fix sweep would queue every kubelet readiness probe
 * behind it until the kernel keepalive (~2 h) tore the socket down,
 * and the pod would appear `Running` but unreachable on port 3000.
 *
 * To keep the suite fast we override the env knob to ms-level, so
 * a stuck `SELECT 1` resolves the timeout race within ~50 ms.
 */
describe("TenantConnectionManager.verifyConnectivity hung-pool guard", () => {
  let originalProbeTimeout: string | undefined;
  beforeEach(() => {
    process.env.POSTGRES_PASSWORD = "test-password";
    originalProbeTimeout = process.env.TENANT_POOL_PROBE_TIMEOUT_MS;
    process.env.TENANT_POOL_PROBE_TIMEOUT_MS = "50";
  });
  afterEach(() => {
    delete process.env.POSTGRES_PASSWORD;
    if (originalProbeTimeout === undefined) {
      delete process.env.TENANT_POOL_PROBE_TIMEOUT_MS;
    } else {
      process.env.TENANT_POOL_PROBE_TIMEOUT_MS = originalProbeTimeout;
    }
  });

  function makeHangingPool(): IFakePool {
    const fn = (() => new Promise<unknown>(() => undefined)) as ((
      ..._args: unknown[]
    ) => Promise<unknown>) &
      IFakePool;
    fn.end = mock(() => Promise.resolve());
    fn.setQueryResult = () => {
      // Hanging pool ignores result mutation; it stays hung until
      // the per-probe timeout race wins.
    };
    return fn as unknown as IFakePool;
  }

  it("evicts a pool whose SELECT 1 never resolves and returns false within the budget", async () => {
    // Re-import the module so the new env value is picked up by the
    // module-level PROBE_TIMEOUT_MS constant. Bun's mock.module would
    // be cleaner, but `delete require.cache` works here because the
    // SUT is a plain TS file with no side-effectful imports.
    delete require.cache[require.resolve("../../src/tenant-connection-manager")];
    const { TenantConnectionManager: TCM } = await import(
      "../../src/tenant-connection-manager"
    );

    const mgr = new TCM();
    const priv = asPrivate(mgr as unknown as TenantConnectionManager);
    const hung = makeHangingPool();
    priv.pools.set("dedicated:acme-dedicated:postgres", hung);
    priv.initialized.add("dedicated:acme-dedicated:postgres");

    const start = Date.now();
    const ok = await mgr.verifyConnectivity();
    const elapsed = Date.now() - start;

    expect(ok).toBe(false);
    expect(elapsed).toBeLessThan(500);
    expect(priv.pools.has("dedicated:acme-dedicated:postgres")).toBe(false);
    expect(priv.initialized.has("dedicated:acme-dedicated:postgres")).toBe(false);
  });

  it("a hung pool does not starve a healthy sibling probe", async () => {
    delete require.cache[require.resolve("../../src/tenant-connection-manager")];
    const { TenantConnectionManager: TCM } = await import(
      "../../src/tenant-connection-manager"
    );

    const mgr = new TCM();
    const priv = asPrivate(mgr as unknown as TenantConnectionManager);
    const hung = makeHangingPool();
    const healthy = makeFakePool();
    healthy.setQueryResult("ok");
    priv.pools.set("dedicated:acme-dedicated:postgres", hung);
    priv.pools.set("shared-tenant:globex:tenant_globex:tenant_globex_app", healthy);

    const start = Date.now();
    const ok = await mgr.verifyConnectivity();
    const elapsed = Date.now() - start;

    expect(ok).toBe(true);
    expect(elapsed).toBeLessThan(500);
    expect(priv.pools.has("dedicated:acme-dedicated:postgres")).toBe(false);
    expect(priv.pools.has("shared-tenant:globex:tenant_globex:tenant_globex_app")).toBe(true);
  });
});
