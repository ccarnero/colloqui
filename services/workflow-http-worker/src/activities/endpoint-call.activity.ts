import Redis from "ioredis";
import { tracedFetch } from "@yoizen/observability";
import {
  createAdapterClientWithRedisAndFetch,
  sleep,
  TENANT_HEADER,
} from "@yoizen/shared";
import type { EndpointCallArgs } from "@yoizen/shared";
import { workflowHttpWorkerConfig } from "../config";

interface IEndpointCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

let adapterClient: ReturnType<
  typeof createAdapterClientWithRedisAndFetch
> | null = null;

function getAdapterClient(): ReturnType<
  typeof createAdapterClientWithRedisAndFetch
> {
  if (adapterClient) return adapterClient;

  const redis = new Redis({
    host: workflowHttpWorkerConfig.redisHost,
    port: workflowHttpWorkerConfig.redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  adapterClient = createAdapterClientWithRedisAndFetch(
    workflowHttpWorkerConfig.adapterServiceUrl,
    redis,
    tracedFetch,
  );

  return adapterClient;
}

/**
 * Temporal activity: performs an HTTP call, optionally resolved via {@link AdapterClient}.
 *
 * @param args - Method, URL, body, optional adapter/endpoint ids.
 * @param tenantId - Injected tenant for adapter resolution and `x-yoizen-tenant`.
 * @returns Normalized status, body, and string headers.
 */
export async function executeEndpointCall(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  if (args.adapterId && args.endpointId) {
    return executeWithAdapter(args, tenantId);
  }
  return executeRaw(args, tenantId);
}

async function executeWithAdapter(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  const client = getAdapterClient();
  const resolved = await client.resolveRequest(
    tenantId,
    args.adapterId!,
    args.endpointId!,
  );

  const mergedHeaders: Record<string, string> = {
    ...resolved.headers,
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(resolved.url, args.params);
  const body = applyJsonBody(args.data, mergedHeaders);

  let lastError: unknown;

  for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = resolved.retryBackoffMs * (1 << (attempt - 1));
      await sleep(delay);
    }

    try {
      const res = await tracedFetch(url, {
        method: resolved.method,
        headers: mergedHeaders,
        body,
        signal: AbortSignal.timeout(resolved.timeoutMs),
      });

      if (res.ok || attempt === resolved.maxRetries || res.status < 500) {
        return buildResult(res);
      }

      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === resolved.maxRetries) break;
    }
  }

  throw lastError;
}

async function executeRaw(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<IEndpointCallResult> {
  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(args.url, args.params);
  const body = applyJsonBody(args.data, headers);

  return fetchWithTenantTimeout({
    method: args.method,
    url,
    headers,
    body,
    timeoutMs: 30_000,
  });
}

function buildUrl(base: string, params?: Record<string, unknown>): string {
  if (!params) return base;
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Shared JSON body + Content-Type for POST-like payloads. */
function applyJsonBody(
  data: unknown,
  headers: Record<string, string>,
): string | undefined {
  if (data === undefined) return undefined;
  headers["Content-Type"] ??= "application/json";
  return JSON.stringify(data);
}

interface IFetchWithTenantTimeoutOptions {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly timeoutMs: number;
}

async function fetchWithTenantTimeout(
  options: IFetchWithTenantTimeoutOptions,
): Promise<IEndpointCallResult> {
  const { method, url, headers, body, timeoutMs } = options;
  const res = await tracedFetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return buildResult(res);
}

async function buildResult(res: Response): Promise<IEndpointCallResult> {
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
