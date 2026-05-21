import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type * as k8s from "@kubernetes/client-node";
import { PinoLoggerService } from "@yoizen/observability";
import {
  REGISTRY_KNATIVE_GROUP,
  REGISTRY_KNATIVE_SERVICES_PLURAL,
  REGISTRY_KNATIVE_VERSION,
} from "@yoizen/shared";
import { tenantServiceConfig } from "../config";
import { isKubernetesConflictError } from "./kubernetes-errors";
import { K8S_CUSTOM_OBJECTS_API } from "./kubernetes.provider";

const KSVC_NAME = "yoizenclaw-runtime";
const CONTAINER_PORT = 8080;
const POSTGRES_CREDENTIALS_SECRET = "postgres-credentials";

const LABELS: Readonly<Record<string, string>> = {
  "app.kubernetes.io/name": KSVC_NAME,
  "app.kubernetes.io/component": KSVC_NAME,
  "app.kubernetes.io/part-of": "yoizen-arch",
  "app.kubernetes.io/managed-by": "tenant-service",
};

const KNATIVE_SERVICE_REF = {
  group: REGISTRY_KNATIVE_GROUP,
  version: REGISTRY_KNATIVE_VERSION,
  plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
} as const;

/**
 * Pure-input parameters for `buildYoizenClawRuntimeServiceBody`.
 *
 * Kept narrow so unit tests construct it without the full Nest container,
 * and so the body builder is a deterministic pure function (no `process.env`
 * reads, no clock).
 */
export interface IYoizenClawRuntimeBuildParams {
  readonly namespace: string;
  readonly tenantId: string;
  readonly image: string;
  readonly natsUrl: string;
  readonly connectorAdminUrl: string;
  readonly otelEndpoint: string;
}

export interface IYoizenClawRuntimeApplyParams {
  readonly namespace: string;
  readonly tenantId: string;
}

/**
 * Builds the Knative Service body that materializes yoizenclaw-runtime in a
 * tenant namespace. Mirrors `knative/tenant-yoizenclaw-runtime/base/yoizenclaw-runtime.yaml`
 * 1:1 — keep them in sync. Resolves Postgres credentials at pod runtime via
 * the per-namespace `postgres-credentials` Secret written by
 * `TenantPostgresProvisioner`, so this body is identical for shared and
 * dedicated tiers.
 *
 * Returns a plain object (`Record<string, unknown>`) to match the shape that
 * `CustomObjectsApi.createNamespacedCustomObject` expects.
 */
export function buildYoizenClawRuntimeServiceBody(
  params: IYoizenClawRuntimeBuildParams,
): Record<string, unknown> {
  const { namespace, tenantId, image, natsUrl, connectorAdminUrl, otelEndpoint } =
    params;

  return {
    apiVersion: `${REGISTRY_KNATIVE_GROUP}/${REGISTRY_KNATIVE_VERSION}`,
    kind: "Service",
    metadata: {
      name: KSVC_NAME,
      namespace,
      labels: { ...LABELS, "yoizen.io/tenant": tenantId },
    },
    spec: {
      template: {
        metadata: {
          labels: { ...LABELS, "yoizen.io/tenant": tenantId },
          annotations: {
            "autoscaling.knative.dev/class": "kpa.autoscaling.knative.dev",
            "autoscaling.knative.dev/metric": "concurrency",
            "autoscaling.knative.dev/target": "50",
            "autoscaling.knative.dev/min-scale": "1",
            "autoscaling.knative.dev/max-scale": "3",
          },
        },
        spec: {
          containerConcurrency: 0,
          timeoutSeconds: 300,
          containers: [
            {
              name: "user-container",
              image,
              ports: [{ containerPort: CONTAINER_PORT, protocol: "TCP" }],
              env: [
                { name: "TENANT_ID", value: tenantId },
                { name: "NATS_URL", value: natsUrl },
                { name: "POSTGRES_HOST", value: "postgres" },
                { name: "POSTGRES_PORT", value: "5432" },
                {
                  name: "POSTGRES_DB",
                  valueFrom: {
                    secretKeyRef: {
                      name: POSTGRES_CREDENTIALS_SECRET,
                      key: "POSTGRES_DB",
                    },
                  },
                },
                {
                  name: "POSTGRES_USER",
                  valueFrom: {
                    secretKeyRef: {
                      name: POSTGRES_CREDENTIALS_SECRET,
                      key: "POSTGRES_USER",
                    },
                  },
                },
                {
                  name: "POSTGRES_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: POSTGRES_CREDENTIALS_SECRET,
                      key: "POSTGRES_PASSWORD",
                    },
                  },
                },
                { name: "CONNECTOR_ADMIN_URL", value: connectorAdminUrl },
                { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: otelEndpoint },
                { name: "OTEL_SERVICE_NAME", value: KSVC_NAME },
              ],
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                seccompProfile: { type: "RuntimeDefault" },
              },
              resources: {
                requests: { cpu: "250m", memory: "256Mi" },
                limits: { cpu: "1", memory: "512Mi" },
              },
              readinessProbe: {
                httpGet: { path: "/health", port: CONTAINER_PORT },
                initialDelaySeconds: 10,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: { path: "/health", port: CONTAINER_PORT },
                initialDelaySeconds: 30,
                periodSeconds: 20,
              },
            },
          ],
        },
      },
    },
  };
}

/**
 * Applies the per-tenant `yoizenclaw-runtime` Knative Service into the tenant
 * namespace.
 *
 * Idempotent reconcile loop:
 *  - first attempt is `createNamespacedCustomObject`;
 *  - on HTTP 409 (already exists), falls back to
 *    `replaceNamespacedCustomObject` so re-runs converge on the desired body
 *    without piling up `kubectl patch`-style annotations.
 *
 * Tenant deletion is handled by the existing namespace-delete cascade in
 * `TenantsService.deleteTenant`; no separate teardown method is required.
 */
@Injectable()
export class YoizenClawRuntimeProvisioner {
  private readonly logger = new PinoLoggerService(
    YoizenClawRuntimeProvisioner.name,
  );

  constructor(
    @Inject(K8S_CUSTOM_OBJECTS_API)
    private readonly customApi: k8s.CustomObjectsApi,
  ) {}

  /**
   * Reconciles the Knative Service in the tenant namespace. Returns the
   * applied resource version for observability; never throws on an
   * already-applied state.
   */
  async apply(params: IYoizenClawRuntimeApplyParams): Promise<void> {
    if (!tenantServiceConfig.yoizenclawRuntimeAutoApply) {
      this.logger.log(
        `Skipping yoizenclaw-runtime apply for tenant=${params.tenantId} ` +
          `ns=${params.namespace} (YOIZENCLAW_RUNTIME_AUTO_APPLY=false)`,
      );
      return;
    }

    const body = buildYoizenClawRuntimeServiceBody({
      namespace: params.namespace,
      tenantId: params.tenantId,
      image: tenantServiceConfig.yoizenclawRuntimeImage,
      natsUrl: tenantServiceConfig.yoizenclawRuntimeNatsUrl,
      connectorAdminUrl: tenantServiceConfig.yoizenclawRuntimeConnectorAdminUrl,
      otelEndpoint: tenantServiceConfig.yoizenclawRuntimeOtelEndpoint,
    });

    try {
      await this.customApi.createNamespacedCustomObject({
        ...KNATIVE_SERVICE_REF,
        namespace: params.namespace,
        body,
      });
      this.logger.log(
        `Created Knative Service ${KSVC_NAME} in ${params.namespace}`,
      );
      return;
    } catch (err: unknown) {
      if (!isKubernetesConflictError(err)) {
        throw err;
      }
    }

    await this.replaceExisting(params.namespace, body);
  }

  /**
   * Conflict path: read the live object to inherit `metadata.resourceVersion`
   * (Kubernetes requires it for `replace`), then replace with the desired
   * body. Kept private so callers always go through `apply`.
   */
  private async replaceExisting(
    namespace: string,
    desired: Record<string, unknown>,
  ): Promise<void> {
    const live = (await this.customApi.getNamespacedCustomObject({
      ...KNATIVE_SERVICE_REF,
      namespace,
      name: KSVC_NAME,
    })) as { metadata?: { resourceVersion?: string } };

    const liveMeta = live.metadata ?? {};
    const desiredMeta =
      (desired.metadata as Record<string, unknown> | undefined) ?? {};
    const merged: Record<string, unknown> = {
      ...desired,
      metadata: {
        ...desiredMeta,
        resourceVersion: liveMeta.resourceVersion,
      },
    };

    await this.customApi.replaceNamespacedCustomObject({
      ...KNATIVE_SERVICE_REF,
      namespace,
      name: KSVC_NAME,
      body: merged,
    });
    this.logger.log(`Replaced Knative Service ${KSVC_NAME} in ${namespace}`);
  }
}

@Global()
@Module({
  providers: [YoizenClawRuntimeProvisioner],
  exports: [YoizenClawRuntimeProvisioner],
})
export class YoizenClawRuntimeModule {}
