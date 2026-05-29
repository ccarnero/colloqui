import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TenantMongoConnectionManager } from "../../src/tenant-mongo-connection-manager";

interface IFakeMongoClient {
  close: ReturnType<typeof mock>;
  db: ReturnType<typeof mock>;
}

function makeFakeClient(mode: "ok" | "fatal" | "hung"): IFakeMongoClient {
  const close = mock(() => Promise.resolve());
  const db = mock(() => ({
    command: () => {
      if (mode === "ok") {
        return Promise.resolve({ ok: 1 });
      }
      if (mode === "fatal") {
        return Promise.reject(new Error("Topology is closed"));
      }
      return new Promise<never>(() => undefined);
    },
  }));
  return { close, db };
}

interface IPrivateMongoManager {
  clients: Map<string, IFakeMongoClient>;
  initialized: Set<string>;
  pendingSchemaInit: Map<string, Promise<void>>;
  knownTenantIds: Set<string>;
  tierCache: Map<string, string>;
  namespaceInitialized: Map<string, Set<string>>;
}

function asPrivate(mgr: TenantMongoConnectionManager): IPrivateMongoManager {
  return mgr as unknown as IPrivateMongoManager;
}

describe("TenantMongoConnectionManager.evictTenant", () => {
  beforeEach(() => {
    process.env.MONGO_PASSWORD = "test-password";
  });
  afterEach(() => {
    delete process.env.MONGO_PASSWORD;
  });

  it("clears the bare tenantId init marker so post-recreate ensureSchema runs again", async () => {
    const mgr = new TenantMongoConnectionManager();
    mgr.markInitialized("test-dedicated-tenant");
    mgr.markInitialized("globex");

    expect(mgr.isInitialized("test-dedicated-tenant")).toBe(true);

    await mgr.evictTenant("test-dedicated-tenant");

    expect(mgr.isInitialized("test-dedicated-tenant")).toBe(false);
    expect(mgr.isInitialized("globex")).toBe(true);
  });

  it("clears namespace-init markers per tenant", async () => {
    const mgr = new TenantMongoConnectionManager();
    mgr.markNamespaceInitialized("gateway_audit", "test-dedicated-tenant");
    mgr.markNamespaceInitialized("gateway_audit", "globex");

    await mgr.evictTenant("test-dedicated-tenant");

    expect(
      mgr.isNamespaceInitialized("gateway_audit", "test-dedicated-tenant"),
    ).toBe(false);
    expect(mgr.isNamespaceInitialized("gateway_audit", "globex")).toBe(true);
  });
});

describe("TenantMongoConnectionManager.verifyConnectivity self-heal", () => {
  let originalProbeTimeout: string | undefined;

  beforeEach(() => {
    process.env.MONGO_PASSWORD = "test-password";
    originalProbeTimeout = process.env.TENANT_POOL_PROBE_TIMEOUT_MS;
    process.env.TENANT_POOL_PROBE_TIMEOUT_MS = "50";
  });
  afterEach(() => {
    delete process.env.MONGO_PASSWORD;
    if (originalProbeTimeout === undefined) {
      delete process.env.TENANT_POOL_PROBE_TIMEOUT_MS;
    } else {
      process.env.TENANT_POOL_PROBE_TIMEOUT_MS = originalProbeTimeout;
    }
  });

  it("clears bare tenant init markers and tier cache when evicting a broken client", async () => {
    delete require.cache[
      require.resolve("../../src/tenant-mongo-connection-manager")
    ];
    const { TenantMongoConnectionManager: TCM } = await import(
      "../../src/tenant-mongo-connection-manager"
    );

    const mgr = new TCM();
    const priv = asPrivate(mgr);
    const broken = makeFakeClient("fatal");
    priv.clients.set("dedicated:test-dedicated-tenant:mongo", broken);
    priv.initialized.add("test-dedicated-tenant");
    priv.initialized.add("dedicated:test-dedicated-tenant:yoizen");
    priv.tierCache.set("test-dedicated-tenant", "dedicated");
    mgr.markNamespaceInitialized("gateway_audit", "test-dedicated-tenant");

    const ok = await mgr.verifyConnectivity();

    expect(ok).toBe(false);
    expect(priv.clients.size).toBe(0);
    expect(mgr.isInitialized("test-dedicated-tenant")).toBe(false);
    expect(priv.initialized.has("dedicated:test-dedicated-tenant:yoizen")).toBe(
      false,
    );
    expect(priv.tierCache.has("test-dedicated-tenant")).toBe(false);
    expect(
      mgr.isNamespaceInitialized("gateway_audit", "test-dedicated-tenant"),
    ).toBe(false);
    expect(broken.close.mock.calls.length).toBe(1);
  });
});
