import {
  REGISTRY_KNATIVE_GROUP,
  REGISTRY_KNATIVE_VERSION,
} from "@yoizen/shared";

/** Minimal Knative Service resource for get/replace patch flows. */
export interface IKnativeServiceResourcePatch {
  apiVersion?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  spec: {
    template: {
      metadata?: { annotations?: Record<string, string> };
      spec: {
        containers: Array<{
          name: string;
          image: string;
          ports: Array<{ containerPort: number; protocol: string }>;
          env?: Array<{ name: string; value: string }>;
        }>;
      };
    };
  };
}

/**
 * Maps env key/value pairs to Knative container `env` entries (O(n) in key count).
 */
export function envRecordToKnativeEnvList(
  envVars: Record<string, string>,
): Array<{ name: string; value: string }> {
  return Object.entries(envVars).map(([name, value]) => ({ name, value }));
}

/** Options for `buildKnativeServiceBody` (single object → easier to extend). */
export interface IBuildKnativeServiceBodyParams {
  namespace: string;
  name: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
}

export function buildKnativeServiceBody(
  params: IBuildKnativeServiceBodyParams,
): Record<string, unknown> {
  const {
    namespace,
    name,
    image,
    port,
    minScale,
    maxScale,
    concurrencyTarget,
    envVars,
  } = params;
  const envList = envRecordToKnativeEnvList(envVars);

  return {
    apiVersion: `${REGISTRY_KNATIVE_GROUP}/${REGISTRY_KNATIVE_VERSION}`,
    kind: "Service",
    metadata: {
      name,
      namespace,
      labels: {
        "app.kubernetes.io/managed-by": "registry-service",
        "app.kubernetes.io/part-of": "yoizen-arch",
      },
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            "autoscaling.knative.dev/class": "kpa.autoscaling.knative.dev",
            "autoscaling.knative.dev/metric": "concurrency",
            "autoscaling.knative.dev/target": String(concurrencyTarget),
            "autoscaling.knative.dev/min-scale": String(minScale),
            "autoscaling.knative.dev/max-scale": String(maxScale),
          },
        },
        spec: {
          containerConcurrency: 0,
          containers: [
            {
              name: "user-container",
              image,
              ports: [{ containerPort: port, protocol: "TCP" }],
              ...(envList.length > 0 ? { env: envList } : {}),
              securityContext: {
                runAsNonRoot: true,
                runAsUser: 1001,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                seccompProfile: { type: "RuntimeDefault" },
              },
              resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "500m", memory: "256Mi" },
              },
              readinessProbe: {
                httpGet: { path: "/health", port },
                initialDelaySeconds: 5,
                periodSeconds: 5,
              },
            },
          ],
        },
      },
    },
  };
}
