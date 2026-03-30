import Redis from "ioredis";
import { tracedFetch } from "@yoizen/observability";
import {
  AdapterClient,
  DEFAULT_ADAPTER_SERVICE_URL,
  TENANT_HEADER,
} from "@yoizen/shared";
import type { EndpointCallArgs } from "@yoizen/shared";

export interface EndpointCallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

let adapterClient: AdapterClient | null = null;

function getAdapterClient(): AdapterClient {
  if (adapterClient) return adapterClient;

  const redis = new Redis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? "6379"),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  adapterClient = new AdapterClient({
    baseUrl:
      process.env.ADAPTER_SERVICE_URL ?? DEFAULT_ADAPTER_SERVICE_URL,
    fetchFn: tracedFetch,
    cache: redis,
  });

  return adapterClient;
}

export async function executeEndpointCall(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<EndpointCallResult> {
  if (args.adapterId && args.endpointId) {
    return executeWithAdapter(args, tenantId);
  }
  return executeRaw(args, tenantId);
}

async function executeWithAdapter(
  args: EndpointCallArgs,
  tenantId: string,
): Promise<EndpointCallResult> {
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
  const body = args.data !== undefined ? JSON.stringify(args.data) : undefined;
  if (body) {
    mergedHeaders["Content-Type"] ??= "application/json";
  }

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
): Promise<EndpointCallResult> {
  const headers: Record<string, string> = {
    [TENANT_HEADER]: tenantId,
    ...args.headers,
  };

  const url = buildUrl(args.url, args.params);
  const body = args.data !== undefined ? JSON.stringify(args.data) : undefined;
  if (body) {
    headers["Content-Type"] ??= "application/json";
  }

  const res = await tracedFetch(url, {
    method: args.method,
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });

  return buildResult(res);
}

function buildUrl(
  base: string,
  params?: Record<string, unknown>,
): string {
  if (!params) return base;
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function buildResult(res: Response): Promise<EndpointCallResult> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
