import { ApplicationFailure } from "@temporalio/activity";
import { tracedFetch, PinoLoggerService } from "@yoizen/observability";
import { TENANT_HEADER, computeBreakerKey } from "@yoizen/shared";
import type { HttpServiceRequest, ResolvedAdapterRequest } from "@yoizen/shared";
import { httpAdapterConfig } from "../config";
import {
  getAdapterClient,
  getHttpResponseCache,
} from "./_shared/adapter-client.provider";
import { getHttpBreaker } from "./_shared/breaker";
import {
  applyJsonBody,
  buildResult,
  httpCallWithRetry,
  type IHttpCallResult,
} from "./_shared/http-call-with-retry";
import { cachedFetch } from "./_shared/http-cache/cached-fetch";
import {
  createBypassHttpResponseCacheDecision,
  resolveHttpResponseCachePolicy,
} from "./_shared/http-cache/cache-policy";
import {
  HttpResponseCacheReason,
  serviceCallResolutionSourceTotal,
} from "./_shared/metrics";

type IServiceCallResult = IHttpCallResult;

interface IRegisteredServiceResponse {
  knativeName: string | null;
  namespace: string | null;
}

const SERVICE_CALL_TIMEOUT_MS = 30_000;
const SERVICE_CALL_REGISTRY_LOOKUP_TIMEOUT_MS = 10_000;

const logger = new PinoLoggerService("service-call.activity");

/**
 * Mirror-first service call.
 *
 * 1. Look up the internal-adapter mirror (`context=internal`, `name=serviceId`).
 *    If present, route the request through `AdapterClient`:
 *     - `args.endpointId` set  → resolve to the adapter endpoint's method/path.
 *     - `args.endpointId` absent → hybrid mode: baseUrl + `args.path`, `args.method`.
 * 2. Otherwise, fall back to the legacy `registry-service /services/:id` lookup
 *    and Knative DNS construction — preserves behaviour while adoption ramps up.
 */
export async function executeServiceCall(
  args: HttpServiceRequest,
  tenantId: string,
): Promise<IServiceCallResult> {
  const breaker = getHttpBreaker();
  const key = computeBreakerKey({
    tenantId,
    kind: "service",
    serviceId: args.serviceId,
    endpointId: args.endpointId,
  });

  const decision = await breaker.canProceed(key);
  if (decision.action === "deny") {
    throw ApplicationFailure.nonRetryable(
      `Circuit breaker ${decision.status} for service call '${args.serviceId}' (${decision.reason})`,
      "CIRCUIT_OPEN",
      { key, status: decision.status, reason: decision.reason },
    );
  }

  try {
    const result = await executeServiceCallInner(args, tenantId);
    breaker.recordSuccess(key);
    return result;
  } catch (err) {
    breaker.recordFailure(key);
    throw err;
  }
}

async function executeServiceCallInner(
  args: HttpServiceRequest,
  tenantId: string,
): Promise<IServiceCallResult> {
  const client = getAdapterClient();
  const mirror = await client.findInternalByServiceId(tenantId, args.serviceId);

  if (mirror) {
    try {
      const resolved = await resolveViaMirror(
        tenantId,
        args,
        mirror.id,
        args.endpointId,
      );
      const result = await performRequest(resolved, args, tenantId);
      serviceCallResolutionSourceTotal.add(1, {
        source: "mirror",
        result: "ok",
      });
      return result;
    } catch (err) {
      serviceCallResolutionSourceTotal.add(1, {
        source: "mirror",
        result: "error",
      });
      throw err;
    }
  }

  logger.log(
    `service-call mirror miss: falling back to registry for '${args.serviceId}' tenant=${tenantId}`,
  );
  try {
    const result = await resolveAndCallViaRegistry(args, tenantId);
    serviceCallResolutionSourceTotal.add(1, {
      source: "registry",
      result: "ok",
    });
    return result;
  } catch (err) {
    serviceCallResolutionSourceTotal.add(1, {
      source: "registry",
      result: "error",
    });
    throw err;
  }
}

async function resolveViaMirror(
  tenantId: string,
  args: HttpServiceRequest,
  adapterId: string,
  endpointId: string | undefined,
): Promise<ResolvedAdapterRequest> {
  const client = getAdapterClient();
  if (endpointId) {
    return client.resolveRequest(tenantId, adapterId, endpointId);
  }
  const resolved = await client.resolveForInternalService(
    tenantId,
    args.serviceId,
    {
      path: args.path,
      method: args.method,
    },
  );
  if (!resolved) {
    throw new Error(
      `Adapter mirror for service '${args.serviceId}' disappeared mid-call`,
    );
  }
  return resolved;
}

async function performRequest(
  resolved: ResolvedAdapterRequest,
  args: HttpServiceRequest,
  tenantId: string,
): Promise<IServiceCallResult> {
  const headers: Record<string, string> = {
    ...resolved.headers,
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };
  const body = applyJsonBody(args.data, headers);
  const decision = resolveHttpResponseCachePolicy({
    enabled: httpAdapterConfig.httpResponseCacheEnabled,
    strategy: resolved.cache,
    tenantId,
    method: resolved.method,
    url: resolved.url,
    headers,
    body,
  });

  return httpCallWithRetry({
    url: resolved.url,
    method: resolved.method,
    headers,
    body,
    timeoutMs: resolved.timeoutMs,
    maxRetries: resolved.maxRetries,
    retryBackoffMs: resolved.retryBackoffMs,
    cache: {
      decision,
      store: getHttpResponseCache(),
    },
  });
}

async function resolveAndCallViaRegistry(
  args: HttpServiceRequest,
  tenantId: string,
): Promise<IServiceCallResult> {
  const baseUrl = await resolveServiceUrl(args.serviceId, tenantId);
  const url = `${baseUrl}${args.path}`;

  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };
  const body = applyJsonBody(args.data, headers);
  const decision = createBypassHttpResponseCacheDecision(
    args.method,
    HttpResponseCacheReason.UNSUPPORTED_TARGET,
  );
  const res = await cachedFetch(
    url,
    {
      method: args.method,
      headers,
      body,
      signal: AbortSignal.timeout(SERVICE_CALL_TIMEOUT_MS),
    },
    {
      decision,
      cache: getHttpResponseCache(),
      fetchFn: tracedFetch,
    },
  );

  return buildResult(res);
}

async function resolveServiceUrl(
  serviceId: string,
  tenantId: string,
): Promise<string> {
  const registryUrl = `${httpAdapterConfig.registryServiceUrl}/services/${serviceId}`;

  const res = await tracedFetch(registryUrl, {
    method: "GET",
    headers: { [TENANT_HEADER]: tenantId },
    signal: AbortSignal.timeout(SERVICE_CALL_REGISTRY_LOOKUP_TIMEOUT_MS),
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
