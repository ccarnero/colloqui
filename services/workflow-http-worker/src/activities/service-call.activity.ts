import { tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import type { ServiceCallArgs } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../config";

interface IServiceCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

interface IRegisteredServiceResponse {
  knativeName: string | null;
  namespace: string | null;
}

const SERVICE_CALL_TIMEOUT_MS = 30_000;

/**
 * Resolves a registered service URL from registry-service, then
 * performs the HTTP call against the resolved Kubernetes DNS endpoint.
 *
 * @param args - Service id, HTTP method, path, optional body/headers.
 * @param tenantId - Tenant for registry lookup and x-yoizen-tenant header.
 * @returns Normalized status, body, and string headers.
 */
export async function executeServiceCall(
  args: ServiceCallArgs,
  tenantId: string,
): Promise<IServiceCallResult> {
  const baseUrl = await resolveServiceUrl(args.serviceId, tenantId);

  const url = `${baseUrl}${args.path}`;

  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  let body: string | undefined;
  if (args.data !== undefined) {
    headers["Content-Type"] ??= "application/json";
    body = JSON.stringify(args.data);
  }

  const res = await tracedFetch(url, {
    method: args.method,
    headers,
    body,
    signal: AbortSignal.timeout(SERVICE_CALL_TIMEOUT_MS),
  });

  return buildResult(res);
}

async function resolveServiceUrl(
  serviceId: string,
  tenantId: string,
): Promise<string> {
  const registryUrl =
    `${workflowHttpWorkerConfig.registryServiceUrl}/services/${serviceId}`;

  const res = await tracedFetch(registryUrl, {
    method: "GET",
    headers: { [TENANT_HEADER]: tenantId },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(
      `Registry lookup failed for service '${serviceId}': HTTP ${res.status}`,
    );
  }

  const svc = (await res.json()) as IRegisteredServiceResponse;

  if (!svc.knativeName || !svc.namespace) {
    throw new Error(
      `Service '${serviceId}' has no Knative deployment (missing knativeName/namespace)`,
    );
  }

  return `http://${svc.knativeName}.${svc.namespace}.svc.cluster.local`;
}

async function buildResult(res: Response): Promise<IServiceCallResult> {
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  let data: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: responseHeaders };
}
