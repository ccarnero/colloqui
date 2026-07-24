import {
  REGISTRY_KNATIVE_GROUP,
  REGISTRY_KNATIVE_VERSION,
} from "@yoizen/shared";
import type { ServiceEnvVars } from "./services.dto";

/**
 * One Knative container `env[]` entry — either a literal value (unchanged)
 * or the k8s-native `valueFrom.secretKeyRef` variant (manual-loops/
 * provisioning-manifest-gaps-4.md T04, Option B, human ruling 2026-07-24).
 * A single `env[]` array legally mixes both entry shapes.
 */
export type KnativeEnvEntry =
  | { name: string; value: string }
  | {
      name: string;
      valueFrom: { secretKeyRef: { name: string; key: string } };
    };

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
          env?: KnativeEnvEntry[];
        }>;
      };
    };
  };
}

/**
 * Maps env key/value pairs to Knative container `env` entries (O(n) in key
 * count). manual-loops/provisioning-manifest-gaps-4.md T04 (Option B, human
 * ruling 2026-07-24): a plain-string value maps to `{ name, value }`
 * (unchanged); a `{ secretKeyRef }` value maps to the k8s-native
 * `{ name, valueFrom: { secretKeyRef } }` variant — registry-service never
 * sees/handles the resolved secret value itself, k8s resolves it at pod
 * start from the referenced Secret.
 */
export function envRecordToKnativeEnvList(
  envVars: ServiceEnvVars
): KnativeEnvEntry[] {
  return Object.entries(envVars).map(([name, value]) => {
    if (typeof value === "string") {
      return { name, value };
    }
    return { name, valueFrom: { secretKeyRef: value.secretKeyRef } };
  });
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
  envVars: ServiceEnvVars;
}

export function buildKnativeServiceBody(
  params: IBuildKnativeServiceBodyParams
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
