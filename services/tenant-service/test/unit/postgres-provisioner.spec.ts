import "../setup-env";
import { describe, it, expect, mock } from "bun:test";
import { TenantDatabaseTier } from "@yoizen/shared";
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

  it("provisionShared materializes postgres-credentials Secret + ExternalName Service in the tenant namespace", async () => {
    const createNamespacedSecret = mock(() => Promise.resolve());
    const createNamespacedService = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret,
      createNamespacedService,
    };
    const provisioner = new TenantPostgresProvisioner(
      coreApi as never,
      {} as never,
    );
    const fakeAdminSql = Object.assign(
      mock(() => Promise.resolve([{ exists: false }])),
      { unsafe: mock(() => Promise.resolve()) },
    );
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "adminSqlPromise",
      Promise.resolve(fakeAdminSql),
    );
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "ensureSharedDatabaseGrants",
      () => Promise.resolve(),
    );

    await provisioner.provision({
      namespace: "acme-dev-ns",
      tenantId: "acme",
      tier: TenantDatabaseTier.Shared,
    });

    expect(createNamespacedSecret).toHaveBeenCalledTimes(1);
    const secretCall = createNamespacedSecret.mock.calls[0]![0] as {
      namespace: string;
      body: {
        metadata: { name: string; labels: Record<string, string> };
        stringData: Record<string, string>;
      };
    };
    expect(secretCall.namespace).toBe("acme-dev-ns");
    expect(secretCall.body.metadata.name).toBe("postgres-credentials");
    expect(secretCall.body.metadata.labels["yoizen.io/postgres-tier"]).toBe(
      "shared",
    );
    expect(secretCall.body.stringData.POSTGRES_DB).toBe("tenant_acme");
    expect(secretCall.body.stringData.POSTGRES_USER).toBe("tenant_acme_app");
    expect(secretCall.body.stringData.POSTGRES_PASSWORD).toBeDefined();

    expect(createNamespacedService).toHaveBeenCalledTimes(1);
    const svcCall = createNamespacedService.mock.calls[0]![0] as {
      namespace: string;
      body: {
        metadata: { name: string };
        spec: { type: string; externalName: string };
      };
    };
    expect(svcCall.namespace).toBe("acme-dev-ns");
    expect(svcCall.body.metadata.name).toBe("postgres");
    expect(svcCall.body.spec.type).toBe("ExternalName");
    expect(svcCall.body.spec.externalName).toMatch(
      /^postgres-shared\.support-services-[a-z0-9]+\.svc\.cluster\.local$/,
    );
  });

  it("provisionShared is idempotent on Secret/Service 409 conflicts", async () => {
    const conflict = () =>
      Promise.reject({ response: { statusCode: 409 } });
    const createNamespacedSecret = mock(conflict);
    const createNamespacedService = mock(conflict);
    const coreApi = { createNamespacedSecret, createNamespacedService };
    const provisioner = new TenantPostgresProvisioner(
      coreApi as never,
      {} as never,
    );
    const fakeAdminSql = Object.assign(
      mock(() => Promise.resolve([{ exists: true }])),
      { unsafe: mock(() => Promise.resolve()) },
    );
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "adminSqlPromise",
      Promise.resolve(fakeAdminSql),
    );
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "ensureSharedDatabaseGrants",
      () => Promise.resolve(),
    );

    await expect(
      provisioner.provision({
        namespace: "acme-dev-ns",
        tenantId: "acme",
        tier: TenantDatabaseTier.Shared,
      }),
    ).resolves.toBeUndefined();
    expect(createNamespacedSecret).toHaveBeenCalledTimes(1);
    expect(createNamespacedService).toHaveBeenCalledTimes(1);
  });

  it("deprovisionShared drops database with FORCE and the matching role", async () => {
    const unsafe = mock(() => Promise.resolve());
    const fakeSql = { unsafe };
    const provisioner = new TenantPostgresProvisioner(
      {} as never,
      {} as never,
    );
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "adminSqlPromise",
      Promise.resolve(fakeSql),
    );
    await provisioner.deprovisionShared("acme");
    const calls = unsafe.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      'DROP DATABASE IF EXISTS "tenant_acme" WITH (FORCE)',
      'DROP ROLE IF EXISTS "tenant_acme_app"',
    ]);
  });
});
