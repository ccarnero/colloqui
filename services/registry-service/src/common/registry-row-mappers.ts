import type * as k8s from "@kubernetes/client-node";
import {
  REGISTRY_KNATIVE_GROUP,
  REGISTRY_KNATIVE_VERSION,
  REGISTRY_KNATIVE_SERVICES_PLURAL,
} from "@yoizen/shared";

/** Row shape → API model for `registered_services`. */
export interface IRegisteredService {
  id: string;
  tenantId: string;
  name: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
  status: string;
  knativeName: string | null;
  namespace: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row shape → API model for `service_routes`. */
export interface IServiceRoute {
  id: string;
  serviceId: string;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
  createdAt: string;
}

/** Row shape → API model for `canary_deployments`. */
export interface ICanaryStatus {
  id: string;
  serviceId: string;
  stableRevision: string;
  canaryRevision: string;
  canaryPercent: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function mapRegisteredServiceRow(
  row: Record<string, unknown>,
): IRegisteredService {
  const envVars = row.env_vars;
  return {
    id: String(row.id ?? row._id ?? ""),
    tenantId: String(row.tenant_id ?? ""),
    name: String(row.name ?? ""),
    image: String(row.image ?? ""),
    port: Number(row.port ?? 0),
    minScale: Number(row.min_scale ?? 0),
    maxScale: Number(row.max_scale ?? 0),
    concurrencyTarget: Number(row.concurrency_target ?? 0),
    envVars:
      envVars !== null &&
      typeof envVars === "object" &&
      !Array.isArray(envVars)
        ? (envVars as Record<string, string>)
        : {},
    status: String(row.status ?? ""),
    knativeName:
      row.knative_name === null || row.knative_name === undefined
        ? null
        : String(row.knative_name),
    namespace:
      row.namespace === null || row.namespace === undefined
        ? null
        : String(row.namespace),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function mapServiceRouteRow(row: Record<string, unknown>): IServiceRoute {
  const rawMethods = row.methods;
  const methods = Array.isArray(rawMethods)
    ? rawMethods.map((m) => String(m))
    : [];
  return {
    id: String(row.id ?? row._id ?? ""),
    serviceId: String(row.service_id ?? ""),
    pathPrefix: String(row.path_prefix ?? ""),
    methods,
    isPublic: Boolean(row.is_public),
    stripPrefix: Boolean(row.strip_prefix),
    createdAt: String(row.created_at ?? ""),
  };
}

export function mapCanaryDeploymentRow(
  row: Record<string, unknown>,
): ICanaryStatus {
  return {
    id: String(row.id ?? row._id ?? ""),
    serviceId: String(row.service_id ?? ""),
    stableRevision: String(row.stable_revision ?? ""),
    canaryRevision: String(row.canary_revision ?? ""),
    canaryPercent: Number(row.canary_percent ?? 0),
    status: String(row.status ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const knativeServiceRef = {
  group: REGISTRY_KNATIVE_GROUP,
  version: REGISTRY_KNATIVE_VERSION,
  plural: REGISTRY_KNATIVE_SERVICES_PLURAL,
} as const;

/**
 * Single place for Knative Service get/replace (O(1) param bundle vs repeated literals).
 */
export async function getNamespacedKnativeService(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  name: string,
): ReturnType<k8s.CustomObjectsApi["getNamespacedCustomObject"]> {
  return customApi.getNamespacedCustomObject({
    ...knativeServiceRef,
    namespace,
    name,
  });
}

export async function replaceNamespacedKnativeService(
  customApi: k8s.CustomObjectsApi,
  namespace: string,
  name: string,
  body: Record<string, unknown>,
): ReturnType<k8s.CustomObjectsApi["replaceNamespacedCustomObject"]> {
  return customApi.replaceNamespacedCustomObject({
    ...knativeServiceRef,
    namespace,
    name,
    body,
  });
}
