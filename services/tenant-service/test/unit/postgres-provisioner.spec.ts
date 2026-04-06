import "../setup-env";
import { describe, it, expect, mock } from "bun:test";
import { TenantPostgresProvisioner } from "../../src/providers/postgres.provider";

describe("TenantPostgresProvisioner", () => {
  it("is defined for K8s provisioning module", () => {
    expect(TenantPostgresProvisioner.name).toBe("TenantPostgresProvisioner");
  });

  it("provision applies secret, config, services, and StatefulSet", async () => {
    const createNamespacedSecret = mock(() => Promise.resolve());
    const createNamespacedConfigMap = mock(() => Promise.resolve());
    const createNamespacedService = mock(() => Promise.resolve());
    const createNamespacedStatefulSet = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret,
      createNamespacedConfigMap,
      createNamespacedService,
    };
    const appsApi = { createNamespacedStatefulSet };
    const provisioner = new TenantPostgresProvisioner(
      coreApi as never,
      appsApi as never,
    );
    await provisioner.provision("ns-provision");
    expect(createNamespacedSecret).toHaveBeenCalled();
    expect(createNamespacedConfigMap).toHaveBeenCalled();
    expect(createNamespacedService).toHaveBeenCalledTimes(2);
    expect(createNamespacedStatefulSet).toHaveBeenCalled();
  });

  it("provision ignores HTTP 409 on duplicate resources", async () => {
    const conflict = () =>
      Promise.reject({ response: { statusCode: 409 } });
    const createNamespacedSecret = mock(conflict);
    const createNamespacedConfigMap = mock(() => Promise.resolve());
    const createNamespacedService = mock(() => Promise.resolve());
    const createNamespacedStatefulSet = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret,
      createNamespacedConfigMap,
      createNamespacedService,
    };
    const appsApi = { createNamespacedStatefulSet };
    const provisioner = new TenantPostgresProvisioner(
      coreApi as never,
      appsApi as never,
    );
    await expect(provisioner.provision("ns-409")).resolves.toBeUndefined();
  });

  it("waitForReady resolves when StatefulSet reports a ready replica", async () => {
    const readNamespacedStatefulSet = mock(() =>
      Promise.resolve({
        status: { readyReplicas: 1 },
      }),
    );
    const provisioner = new TenantPostgresProvisioner(
      {} as never,
      { readNamespacedStatefulSet } as never,
    );
    await provisioner.waitForReady("ns-unit", 2_000);
    expect(readNamespacedStatefulSet).toHaveBeenCalledWith({
      name: "postgres",
      namespace: "ns-unit",
    });
  });
});
