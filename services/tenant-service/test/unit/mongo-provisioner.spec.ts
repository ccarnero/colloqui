import "../setup-env";
import { describe, it, expect, mock } from "bun:test";
import { TenantDatabaseTier } from "@yoizen/shared";
import { TenantMongoProvisioner } from "../../src/providers/mongo.provider";

describe("TenantMongoProvisioner", () => {
  it("is defined for K8s provisioning module", () => {
    expect(TenantMongoProvisioner.name).toBe("TenantMongoProvisioner");
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
    const provisioner = new TenantMongoProvisioner(
      coreApi as never,
      appsApi as never,
    );
    await provisioner.provision("ns-provision");
    expect(createNamespacedSecret).toHaveBeenCalled();
    expect(createNamespacedConfigMap).toHaveBeenCalled();
    expect(createNamespacedService).toHaveBeenCalledTimes(2);
    expect(createNamespacedStatefulSet).toHaveBeenCalled();
  });

  it("ConfigMap init script uses FQDN host and logs mongod to stdout", async () => {
    const createNamespacedConfigMap = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret: mock(() => Promise.resolve()),
      createNamespacedConfigMap,
      createNamespacedService: mock(() => Promise.resolve()),
    };
    const appsApi = {
      createNamespacedStatefulSet: mock(() => Promise.resolve()),
    };
    const provisioner = new TenantMongoProvisioner(
      coreApi as never,
      appsApi as never,
    );
    await provisioner.provision("ns-fqdn-check");

    const call = createNamespacedConfigMap.mock.calls[0]![0] as {
      body: { data: Record<string, string> };
    };
    const initScript = call.body.data["init-replica-set.sh"]!;
    const mongodConf = call.body.data["mongod.conf"]!;

    // FQDN host — without it, rs.initiate() fails with
    // "No host described in new configuration ... maps to this node".
    expect(initScript).toContain(
      "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
    );
    expect(initScript).toContain(
      '${STATEFULSET}-${i}.${HEADLESS}.${POD_NS}.${CLUSTER_DOMAIN}:27017',
    );
    // Must NOT contain the short host that triggered the regression.
    expect(initScript).not.toMatch(/\$\{STATEFULSET\}-\$\{i\}\.\$\{HEADLESS\}:27017/);

    // mongod must log to stdout so `kubectl logs` surfaces startup errors.
    expect(mongodConf).toContain("path: /proc/1/fd/1");
  });

  it("provision ignores HTTP 409 on duplicate Secret and Services", async () => {
    const conflict = () =>
      Promise.reject({ response: { statusCode: 409 } });
    const createNamespacedSecret = mock(conflict);
    const readNamespacedConfigMap = mock(() =>
      Promise.resolve({
        metadata: { name: "mongo-config", resourceVersion: "1" },
        data: {},
      }),
    );
    const replaceNamespacedConfigMap = mock(() => Promise.resolve());
    const createNamespacedConfigMap = mock(conflict);
    const createNamespacedService = mock(conflict);
    const createNamespacedStatefulSet = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret,
      createNamespacedConfigMap,
      readNamespacedConfigMap,
      replaceNamespacedConfigMap,
      createNamespacedService,
    };
    const appsApi = { createNamespacedStatefulSet };
    const provisioner = new TenantMongoProvisioner(
      coreApi as never,
      appsApi as never,
    );
    await expect(provisioner.provision("ns-409")).resolves.toBeUndefined();
    expect(replaceNamespacedConfigMap).toHaveBeenCalledTimes(1);
  });

  it("provision replaces StatefulSet when create returns HTTP 409", async () => {
    const conflict = () =>
      Promise.reject({ response: { statusCode: 409 } });
    const createNamespacedSecret = mock(() => Promise.resolve());
    const createNamespacedConfigMap = mock(() => Promise.resolve());
    const createNamespacedService = mock(() => Promise.resolve());
    const createNamespacedStatefulSet = mock(conflict);
    const readNamespacedStatefulSet = mock(() =>
      Promise.resolve({
        metadata: { name: "mongo", resourceVersion: "42" },
        spec: {
          selector: { matchLabels: { "app.kubernetes.io/name": "mongo" } },
          volumeClaimTemplates: [{ metadata: { name: "data" } }],
          template: {
            metadata: { labels: { "app.kubernetes.io/name": "mongo" } },
            spec: { containers: [{ name: "mongo", startupProbe: { timeoutSeconds: 1 } }] },
          },
        },
      }),
    );
    const replaceNamespacedStatefulSet = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret,
      createNamespacedConfigMap,
      createNamespacedService,
    };
    const appsApi = {
      createNamespacedStatefulSet,
      readNamespacedStatefulSet,
      replaceNamespacedStatefulSet,
    };
    const provisioner = new TenantMongoProvisioner(
      coreApi as never,
      appsApi as never,
    );

    await expect(provisioner.provision("ns-reconcile")).resolves.toBeUndefined();

    expect(replaceNamespacedStatefulSet).toHaveBeenCalledTimes(1);
    const replaceCall = replaceNamespacedStatefulSet.mock.calls[0]![0] as {
      namespace: string;
      body: {
        metadata: { resourceVersion?: string };
        spec: {
          selector: { matchLabels: Record<string, string> };
          volumeClaimTemplates: unknown[];
          template: {
            spec: {
              containers: Array<{
                name: string;
                startupProbe?: { timeoutSeconds?: number };
              }>;
            };
          };
        };
      };
    };
    expect(replaceCall.namespace).toBe("ns-reconcile");
    expect(replaceCall.body.metadata.resourceVersion).toBe("42");
    expect(replaceCall.body.spec.selector.matchLabels["app.kubernetes.io/name"]).toBe(
      "mongo",
    );
    expect(replaceCall.body.spec.volumeClaimTemplates).toHaveLength(1);
    const mongoContainer = replaceCall.body.spec.template.spec.containers.find(
      (c) => c.name === "mongo",
    );
    expect(mongoContainer?.startupProbe?.timeoutSeconds).toBe(5);
  });

  it("waitForReady resolves when StatefulSet and authenticated primary probe succeed", async () => {
    const readNamespacedStatefulSet = mock(() =>
      Promise.resolve({
        status: { readyReplicas: 1 },
      }),
    );
    const provisioner = new TenantMongoProvisioner(
      {} as never,
      { readNamespacedStatefulSet } as never,
    );
    (
      provisioner as unknown as {
        probeDedicatedMongoReady: () => Promise<boolean>;
      }
    ).probeDedicatedMongoReady = mock(() => Promise.resolve(true));
    await provisioner.waitForReady("ns-unit", 2_000);
    expect(readNamespacedStatefulSet).toHaveBeenCalledWith({
      name: "mongo",
      namespace: "ns-unit",
    });
  });

  it("waitForReady rejects when Mongo never becomes authenticated-primary ready", async () => {
    const readNamespacedStatefulSet = mock(() =>
      Promise.resolve({
        status: { readyReplicas: 1 },
      }),
    );
    const provisioner = new TenantMongoProvisioner(
      {} as never,
      { readNamespacedStatefulSet } as never,
    );
    (
      provisioner as unknown as {
        probeDedicatedMongoReady: () => Promise<boolean>;
      }
    ).probeDedicatedMongoReady = mock(() => Promise.resolve(false));
    await expect(provisioner.waitForReady("ns-timeout", 100)).rejects.toThrow(
      "MongoDB readiness timeout in ns-timeout",
    );
  });

  it("provisionShared materializes mongo-credentials Secret + ExternalName Service", async () => {
    const createNamespacedSecret = mock(() => Promise.resolve());
    const createNamespacedService = mock(() => Promise.resolve());
    const coreApi = {
      createNamespacedSecret,
      createNamespacedService,
    };
    const provisioner = new TenantMongoProvisioner(
      coreApi as never,
      {} as never,
    );
    const dropDatabase = mock(() => Promise.resolve());
    const command = mock(() => Promise.resolve());
    const fakeClient = {
      db: mock((name: string) => {
        if (name === "admin") {
          return { command, dropUser: mock(() => Promise.resolve()) };
        }
        return { dropDatabase };
      }),
      connect: mock(() => Promise.resolve()),
      close: mock(() => Promise.resolve()),
    };
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "sharedAdminClientPromise",
      Promise.resolve(fakeClient),
    );
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "ensureSharedDatabaseAndUser",
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
    expect(secretCall.body.metadata.name).toBe("mongo-credentials");
    expect(secretCall.body.metadata.labels["yoizen.io/mongo-tier"]).toBe(
      "shared",
    );
    expect(secretCall.body.stringData.MONGO_DB).toBe("tenant_acme");
    expect(secretCall.body.stringData.MONGO_USER).toBe("tenant_acme_app");
    expect(secretCall.body.stringData.MONGO_PASSWORD).toBeDefined();

    expect(createNamespacedService).toHaveBeenCalledTimes(1);
    const svcCall = createNamespacedService.mock.calls[0]![0] as {
      namespace: string;
      body: {
        metadata: { name: string };
        spec: { type: string; externalName: string };
      };
    };
    expect(svcCall.namespace).toBe("acme-dev-ns");
    expect(svcCall.body.metadata.name).toBe("mongo");
    expect(svcCall.body.spec.type).toBe("ExternalName");
    expect(svcCall.body.spec.externalName).toMatch(
      /^mongo-shared\.support-services-[a-z0-9]+\.svc\.cluster\.local$/,
    );
  });

  it("deprovisionShared drops tenant database and role", async () => {
    const dropDatabase = mock(() => Promise.resolve());
    const command = mock(() => Promise.resolve({ ok: 1 }));
    const fakeClient = {
      db: mock((name: string) => {
        if (name === "admin") {
          return { command };
        }
        return { dropDatabase };
      }),
    };
    const provisioner = new TenantMongoProvisioner({} as never, {} as never);
    Reflect.set(
      provisioner as unknown as Record<string, unknown>,
      "sharedAdminClientPromise",
      Promise.resolve(fakeClient),
    );
    await provisioner.deprovisionShared("acme");
    expect(dropDatabase).toHaveBeenCalled();
    expect(command).toHaveBeenCalledWith({ dropUser: "tenant_acme_app" });
  });
});
