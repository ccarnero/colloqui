import "../setup-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * Keep the termination retry loop sub-second so the timeout test doesn't
 * exhaust the 5s default bun:test budget. Restored only after ALL tests run.
 */
const originalTimeout = process.env.TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS;
const originalPoll = process.env.TENANT_NAMESPACE_TERMINATION_POLL_MS;
process.env.PLATFORM_ENVIRONMENT = "dev";

interface ICoreApiStub {
  createNamespace: ReturnType<typeof mock>;
  readNamespace: ReturnType<typeof mock>;
}

interface IRuntimeProvisionerStub {
  apply: ReturnType<typeof mock>;
}

interface IProvisionerStub {
  provision: ReturnType<typeof mock>;
  waitForReady: ReturnType<typeof mock>;
}

interface IJsmStub {
  // ensureTenantIngressStream uses streams(); make it a no-op map.
  streams: {
    info: ReturnType<typeof mock>;
    add: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
}

function makeJsm(): IJsmStub {
  return {
    streams: {
      info: mock(() => Promise.resolve({ config: { subjects: [] } })),
      add: mock(() => Promise.resolve()),
      update: mock(() => Promise.resolve()),
    },
  };
}

beforeAll(() => {
  process.env.TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS = "500";
  process.env.TENANT_NAMESPACE_TERMINATION_POLL_MS = "10";
});

afterAll(() => {
  if (originalTimeout === undefined) {
    delete process.env.TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS;
  } else {
    process.env.TENANT_NAMESPACE_TERMINATION_TIMEOUT_MS = originalTimeout;
  }
  if (originalPoll === undefined) {
    delete process.env.TENANT_NAMESPACE_TERMINATION_POLL_MS;
  } else {
    process.env.TENANT_NAMESPACE_TERMINATION_POLL_MS = originalPoll;
  }
});

describe("TenantProvisioningExecutor.ensureNamespace", () => {
  let TenantProvisioningExecutor: typeof import("../../src/modules/provisioning/tenant-provisioning-executor.service").TenantProvisioningExecutor;

  beforeEach(async () => {
    delete require.cache[
      require.resolve(
        "../../src/modules/provisioning/tenant-provisioning-executor.service",
      )
    ];
    const mod = await import(
      "../../src/modules/provisioning/tenant-provisioning-executor.service"
    );
    TenantProvisioningExecutor = mod.TenantProvisioningExecutor;
  });

  function makeExecutor(coreApi: ICoreApiStub) {
    const provisioner: IProvisionerStub = {
      provision: mock(() => Promise.resolve()),
      waitForReady: mock(() => Promise.resolve()),
    };
    const runtime: IRuntimeProvisionerStub = {
      apply: mock(() => Promise.resolve()),
    };
    const jsm = makeJsm();
    return new TenantProvisioningExecutor(
      coreApi as unknown as Parameters<typeof TenantProvisioningExecutor>[0],
      jsm as unknown as Parameters<typeof TenantProvisioningExecutor>[1],
      provisioner as unknown as Parameters<typeof TenantProvisioningExecutor>[2],
      runtime as unknown as Parameters<typeof TenantProvisioningExecutor>[3],
    );
  }

  it("waits for a Terminating namespace to disappear, then recreates it", async () => {
    const ns = "test-dedicated-tenant-dev-ns";
    let readCalls = 0;
    const coreApi: ICoreApiStub = {
      createNamespace: mock(() => {
        if ((coreApi.createNamespace as ReturnType<typeof mock>).mock.calls.length === 1) {
          return Promise.reject(
            Object.assign(new Error("HTTP-Code: 409"), { code: 409 }),
          );
        }
        return Promise.resolve({
          body: { status: { phase: "Active" } },
        });
      }),
      readNamespace: mock(() => {
        readCalls += 1;
        if (readCalls === 1) {
          return Promise.resolve({
            body: { status: { phase: "Terminating" } },
          });
        }
        if (readCalls === 2) {
          // Still terminating on first wait poll.
          return Promise.resolve({
            body: { status: { phase: "Terminating" } },
          });
        }
        return Promise.reject(
          Object.assign(new Error("HTTP-Code: 404"), { code: 404 }),
        );
      }),
    };

    const executor = makeExecutor(coreApi);
    // call private method through cast to keep the test focused
    const result = await (
      executor as unknown as {
        ensureNamespace: (n: string, ns: string) => Promise<string>;
      }
    ).ensureNamespace("test-dedicated-tenant", ns);

    expect(result).toBe("Active");
    expect(coreApi.createNamespace.mock.calls.length).toBe(2);
    // 1 phase read + N termination polls (≥1 Terminating + 1 NotFound)
    expect(readCalls).toBeGreaterThanOrEqual(3);
  });

  it("returns immediately when the namespace already exists in Active phase", async () => {
    const coreApi: ICoreApiStub = {
      createNamespace: mock(() =>
        Promise.reject(
          Object.assign(new Error("HTTP-Code: 409"), { code: 409 }),
        ),
      ),
      readNamespace: mock(() =>
        Promise.resolve({ body: { status: { phase: "Active" } } }),
      ),
    };

    const executor = makeExecutor(coreApi);
    const result = await (
      executor as unknown as {
        ensureNamespace: (n: string, ns: string) => Promise<string>;
      }
    ).ensureNamespace("test-dedicated-tenant", "test-dedicated-tenant-dev-ns");

    expect(result).toBe("Active");
    expect(coreApi.createNamespace.mock.calls.length).toBe(1);
    expect(coreApi.readNamespace.mock.calls.length).toBe(1);
  });

  it("throws when termination does not finish within the timeout", async () => {
    const coreApi: ICoreApiStub = {
      createNamespace: mock(() =>
        Promise.reject(
          Object.assign(new Error("HTTP-Code: 409"), { code: 409 }),
        ),
      ),
      readNamespace: mock(() =>
        Promise.resolve({ body: { status: { phase: "Terminating" } } }),
      ),
    };

    const executor = makeExecutor(coreApi);

    await expect(
      (
        executor as unknown as {
          ensureNamespace: (n: string, ns: string) => Promise<string>;
        }
      ).ensureNamespace("test-dedicated-tenant", "test-dedicated-tenant-dev-ns"),
    ).rejects.toThrow("did not finish terminating");
  });
});

describe("TenantProvisioningExecutor.run — tier-aware INGRESS creation (TMT T02)", () => {
  const originalBytes = process.env.MESSAGING_MAX_BYTES_CEILING;
  const originalReplicas = process.env.MESSAGING_MAX_REPLICAS_CEILING;

  afterAll(() => {
    if (originalBytes === undefined) {
      delete process.env.MESSAGING_MAX_BYTES_CEILING;
    } else {
      process.env.MESSAGING_MAX_BYTES_CEILING = originalBytes;
    }
    if (originalReplicas === undefined) {
      delete process.env.MESSAGING_MAX_REPLICAS_CEILING;
    } else {
      process.env.MESSAGING_MAX_REPLICAS_CEILING = originalReplicas;
    }
  });

  async function makeRunExecutor() {
    const mod = await import(
      "../../src/modules/provisioning/tenant-provisioning-executor.service"
    );
    const coreApi: ICoreApiStub = {
      createNamespace: mock(() =>
        Promise.resolve({ body: { status: { phase: "Active" } } }),
      ),
      readNamespace: mock(() =>
        Promise.resolve({ body: { status: { phase: "Active" } } }),
      ),
    };
    const provisioner: IProvisionerStub = {
      provision: mock(() => Promise.resolve()),
      waitForReady: mock(() => Promise.resolve()),
    };
    const jsm = makeJsm();
    const executor = new mod.TenantProvisioningExecutor(
      coreApi as never,
      jsm as never,
      provisioner as never,
    );
    return { executor, jsm };
  }

  it("passes the tenant's tier limits, clamped by the env ceilings, to streams.add", async () => {
    // enterprise: 20 GiB / 3 replicas — the dev-style ceilings must cap both.
    process.env.MESSAGING_MAX_BYTES_CEILING = "536870912";
    process.env.MESSAGING_MAX_REPLICAS_CEILING = "1";
    const { executor, jsm } = await makeRunExecutor();

    await executor.run({
      name: "tmt-clamped-enterprise",
      messagingTier: "enterprise",
      configuration: {},
    });

    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    const [cfg] = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    expect(cfg.max_bytes).toBe(536_870_912);
    expect(cfg.num_replicas).toBe(1);
    // Policy fields stay tier-defined: 30d retention, 1 MiB message cap.
    expect(cfg.max_age).toBe(30 * 24 * 60 * 60 * 1_000_000_000);
    expect(cfg.max_msg_size).toBe(1_048_576);
  });

  it("defaults to free-tier limits when no messagingTier is passed", async () => {
    delete process.env.MESSAGING_MAX_BYTES_CEILING;
    delete process.env.MESSAGING_MAX_REPLICAS_CEILING;
    const { executor, jsm } = await makeRunExecutor();

    await executor.run({
      name: "tmt-default-free",
      configuration: {},
    });

    const [cfg] = jsm.streams.add.mock.calls[0] as [Record<string, unknown>];
    expect(cfg.max_bytes).toBe(1_073_741_824);
    expect(cfg.max_age).toBe(7 * 24 * 60 * 60 * 1_000_000_000);
    expect(cfg.num_replicas).toBe(1);
  });
});
