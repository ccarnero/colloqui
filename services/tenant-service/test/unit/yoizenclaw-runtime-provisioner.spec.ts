import "../setup-env";
import { describe, it, expect, mock } from "bun:test";
import {
  buildYoizenClawRuntimeServiceBody,
  YoizenClawRuntimeProvisioner,
} from "../../src/providers/yoizenclaw-runtime.provider";

const PARAMS = {
  namespace: "acme-dev-ns",
  tenantId: "acme",
  image: "dev.local/yoizenclaw-runtime:local",
  natsUrl: "nats://nats.support-services-dev.svc.cluster.local:4222",
  connectorAdminUrl:
    "http://connector-admin-api.platform-services-dev.svc.cluster.local",
  otelEndpoint: "http://otel-collector.support-services-dev.svc.cluster.local:4318",
};

interface IKnativeServiceBody {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace: string; labels: Record<string, string> };
  spec: {
    template: {
      metadata: { labels: Record<string, string>; annotations: Record<string, string> };
      spec: {
        containerConcurrency: number;
        timeoutSeconds: number;
        containers: Array<{
          name: string;
          image: string;
          ports: Array<{ containerPort: number; protocol: string }>;
          env: Array<{
            name: string;
            value?: string;
            valueFrom?: { secretKeyRef: { name: string; key: string } };
          }>;
        }>;
      };
    };
  };
}

describe("buildYoizenClawRuntimeServiceBody", () => {
  it("renders apiVersion + kind + namespace-scoped metadata", () => {
    const body = buildYoizenClawRuntimeServiceBody({
      ...PARAMS,
      dbEngine: "postgres",
    }) as unknown as IKnativeServiceBody;
    expect(body.apiVersion).toBe("serving.knative.dev/v1");
    expect(body.kind).toBe("Service");
    expect(body.metadata.name).toBe("yoizenclaw-runtime");
    expect(body.metadata.namespace).toBe("acme-dev-ns");
    expect(body.metadata.labels["yoizen.io/tenant"]).toBe("acme");
    expect(body.metadata.labels["app.kubernetes.io/managed-by"]).toBe(
      "tenant-service",
    );
  });

  it("postgres engine uses postgres-credentials Secret", () => {
    const body = buildYoizenClawRuntimeServiceBody({
      ...PARAMS,
      dbEngine: "postgres",
    }) as unknown as IKnativeServiceBody;
    const env = body.spec.template.spec.containers[0]!.env;
    const get = (k: string) => env.find((e) => e.name === k)?.value;
    expect(get("DB_ENGINE")).toBe("postgres");
    expect(get("POSTGRES_HOST")).toBe("postgres");
    expect(get("POSTGRES_PORT")).toBe("5432");
    for (const key of ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]) {
      const entry = env.find((e) => e.name === key);
      expect(entry?.valueFrom?.secretKeyRef.name).toBe("postgres-credentials");
      expect(entry?.valueFrom?.secretKeyRef.key).toBe(key);
    }
    expect(env.some((e) => e.name === "MONGO_HOST")).toBe(false);
  });

  it("mongo engine uses mongo-credentials Secret", () => {
    const body = buildYoizenClawRuntimeServiceBody({
      ...PARAMS,
      dbEngine: "mongo",
    }) as unknown as IKnativeServiceBody;
    const env = body.spec.template.spec.containers[0]!.env;
    const get = (k: string) => env.find((e) => e.name === k)?.value;
    expect(get("DB_ENGINE")).toBe("mongo");
    expect(get("MONGO_HOST")).toBe("mongo");
    expect(get("MONGO_PORT")).toBe("27017");
    expect(get("MONGO_REPLICA_SET")).toBe("rs0");
    for (const key of ["MONGO_DB", "MONGO_USER", "MONGO_PASSWORD"]) {
      const entry = env.find((e) => e.name === key);
      expect(entry?.valueFrom?.secretKeyRef.name).toBe("mongo-credentials");
      expect(entry?.valueFrom?.secretKeyRef.key).toBe(key);
    }
    expect(env.some((e) => e.name === "POSTGRES_HOST")).toBe(false);
  });

  it("injects TENANT_ID, NATS_URL, CONNECTOR_ADMIN_URL, and OTEL endpoints from params", () => {
    const body = buildYoizenClawRuntimeServiceBody({
      ...PARAMS,
      dbEngine: "postgres",
    }) as unknown as IKnativeServiceBody;
    const env = body.spec.template.spec.containers[0]!.env;
    const get = (k: string) => env.find((e) => e.name === k)?.value;
    expect(get("TENANT_ID")).toBe("acme");
    expect(get("NATS_URL")).toBe(PARAMS.natsUrl);
    expect(get("CONNECTOR_ADMIN_URL")).toBe(PARAMS.connectorAdminUrl);
    expect(get("OTEL_EXPORTER_OTLP_ENDPOINT")).toBe(PARAMS.otelEndpoint);
    expect(get("OTEL_SERVICE_NAME")).toBe("yoizenclaw-runtime");
  });

  it("applies the same scaling annotations as the kustomize base template", () => {
    const body = buildYoizenClawRuntimeServiceBody({
      ...PARAMS,
      dbEngine: "postgres",
    }) as unknown as IKnativeServiceBody;
    const ann = body.spec.template.metadata.annotations;
    expect(ann["autoscaling.knative.dev/min-scale"]).toBe("1");
    expect(ann["autoscaling.knative.dev/max-scale"]).toBe("3");
    expect(ann["autoscaling.knative.dev/target"]).toBe("50");
  });
});

describe("YoizenClawRuntimeProvisioner.apply", () => {
  it("creates the Knative Service via createNamespacedCustomObject", async () => {
    const createNamespacedCustomObject = mock(() => Promise.resolve());
    const customApi = {
      createNamespacedCustomObject,
      getNamespacedCustomObject: mock(() => Promise.resolve({ metadata: {} })),
      replaceNamespacedCustomObject: mock(() => Promise.resolve()),
    };
    const provisioner = new YoizenClawRuntimeProvisioner(
      customApi as never,
    );

    await provisioner.apply({ namespace: "acme-dev-ns", tenantId: "acme" });

    expect(createNamespacedCustomObject).toHaveBeenCalledTimes(1);
    const arg = createNamespacedCustomObject.mock.calls[0]![0] as {
      namespace: string;
      body: IKnativeServiceBody;
    };
    expect(arg.namespace).toBe("acme-dev-ns");
    expect(arg.body.metadata.namespace).toBe("acme-dev-ns");
  });

  it("replaces on HTTP 409 conflict", async () => {
    const conflict = Object.assign(new Error("conflict"), { statusCode: 409 });
    const createNamespacedCustomObject = mock(() => Promise.reject(conflict));
    const replaceNamespacedCustomObject = mock(() => Promise.resolve());
    const customApi = {
      createNamespacedCustomObject,
      getNamespacedCustomObject: mock(() =>
        Promise.resolve({ metadata: { resourceVersion: "123" } }),
      ),
      replaceNamespacedCustomObject,
    };
    const provisioner = new YoizenClawRuntimeProvisioner(
      customApi as never,
    );

    await provisioner.apply({ namespace: "acme-dev-ns", tenantId: "acme" });

    expect(replaceNamespacedCustomObject).toHaveBeenCalledTimes(1);
    const arg = replaceNamespacedCustomObject.mock.calls[0]![0] as {
      body: { metadata: { resourceVersion?: string } };
    };
    expect(arg.body.metadata.resourceVersion).toBe("123");
  });

  it("propagates non-conflict errors from create", async () => {
    const createNamespacedCustomObject = mock(() =>
      Promise.reject(new Error("forbidden")),
    );
    const customApi = {
      createNamespacedCustomObject,
      getNamespacedCustomObject: mock(() => Promise.resolve({ metadata: {} })),
      replaceNamespacedCustomObject: mock(() => Promise.resolve()),
    };
    const provisioner = new YoizenClawRuntimeProvisioner(
      customApi as never,
    );

    await expect(
      provisioner.apply({ namespace: "acme-dev-ns", tenantId: "acme" }),
    ).rejects.toThrow("forbidden");
  });
});
