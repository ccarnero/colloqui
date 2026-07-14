import { type PinoLoggerService, tracedFetch } from "@yoizen/observability";
import { TENANT_HEADER } from "@yoizen/shared";
import { PROXY_TIMEOUT_MS } from "../constants";
import { throwProxyError } from "./proxy-error.util";

export interface IDownstreamJsonProxyParams {
  readonly baseUrl: string;
  readonly method: string;
  readonly path: string;
  readonly tenantId: string;
  readonly query?: Record<string, string | undefined>;
  readonly body?: unknown;
  readonly serviceLabel: string;
  readonly logger: PinoLoggerService;
  readonly signal?: AbortSignal;
  readonly requestId?: string;
}

/**
 * Tenant-scoped JSON proxy call (single options object; max 3 top-level fields
 * when destructured at call sites).
 */
export type IJsonProxyRequest = Pick<
  IDownstreamJsonProxyParams,
  "method" | "path" | "tenantId" | "query" | "body" | "signal" | "requestId"
>;

/**
 * Factory for tenant-scoped JSON proxies (O(1) closure per service instance).
 * Shared JSON proxy helper for tenant-scoped downstream HTTP calls — O(q) for
 * query string size q.
 */
export function createTenantJsonProxyForwarder(
  baseUrl: string,
  serviceLabel: string,
  logger: PinoLoggerService
): (req: IJsonProxyRequest) => Promise<object> {
  return (req: IJsonProxyRequest) =>
    downstreamJsonProxy({
      baseUrl,
      serviceLabel,
      logger,
      method: req.method,
      path: req.path,
      tenantId: req.tenantId,
      query: req.query,
      body: req.body,
      signal: req.signal,
      requestId: req.requestId,
    });
}

/**
 * `downstreamJsonProxyWithStatus`'s success result — status ALWAYS a 2xx
 * (non-2xx throws via `throwProxyError`, same as `downstreamJsonProxy`).
 */
export interface IDownstreamJsonProxyResult {
  readonly status: number;
  readonly body: object;
}

/**
 * Status-aware variant of `downstreamJsonProxy` (T06 gateway fix,
 * `manual-loops/connector-invoke-api.md`): returns the downstream's REAL
 * 2xx status alongside the body instead of discarding it. Introduced for
 * routes whose contract varies by success status (connector invoke: 200
 * sync vs 202 async accept) — `downstreamJsonProxy` still returns body-only
 * for every other proxy call site, unchanged.
 */
export async function downstreamJsonProxyWithStatus(
  params: IDownstreamJsonProxyParams
): Promise<IDownstreamJsonProxyResult> {
  const qs = new URLSearchParams();
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      if (v !== undefined) {
        qs.set(k, v);
      }
    }
  }
  const queryStr = qs.toString();
  const url = `${params.baseUrl}${params.path}${queryStr ? `?${queryStr}` : ""}`;

  const headers: Record<string, string> = {
    [TENANT_HEADER]: params.tenantId,
  };
  if (params.requestId) {
    headers["x-request-id"] = params.requestId;
  }

  const init: RequestInit = {
    method: params.method,
    headers,
    signal: params.signal ?? AbortSignal.timeout(PROXY_TIMEOUT_MS),
  };

  if (
    params.body !== undefined &&
    params.method !== "GET" &&
    params.method !== "DELETE"
  ) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(params.body);
  }

  const res = await tracedFetch(url, init);
  if (!res.ok) {
    await throwProxyError(res, params.serviceLabel, params.logger);
  }
  if (res.status === 204) {
    return { status: res.status, body: {} };
  }
  return { status: res.status, body: (await res.json()) as object };
}

/** Executes a tenant-scoped JSON downstream HTTP call (O(q) query build). */
export async function downstreamJsonProxy(
  params: IDownstreamJsonProxyParams
): Promise<object> {
  const { body } = await downstreamJsonProxyWithStatus(params);
  return body;
}
