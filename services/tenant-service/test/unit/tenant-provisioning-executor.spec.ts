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
