import { createHash } from "node:crypto";
import {
  AdapterCacheMethod,
  AdapterCacheQueryParamsMode,
  type AdapterCacheMethodValue,
  type AdapterCacheStrategy,
} from "@yoizen/shared";
import {
  HttpResponseCacheReason,
  type HttpResponseCacheReasonValue,
} from "../metrics";

const DEFAULT_CACHE_METHODS: readonly AdapterCacheMethodValue[] = [
  AdapterCacheMethod.GET,
  AdapterCacheMethod.HEAD,
] as const;

const METHODS_WITH_BODY_KEY = new Set<AdapterCacheMethodValue>([
  AdapterCacheMethod.POST,
  AdapterCacheMethod.PUT,
  AdapterCacheMethod.PATCH,
  AdapterCacheMethod.DELETE,
]);

export interface IHttpResponseCachePolicy {
  readonly key: string;
  readonly ttlSeconds: number;
}

export interface IHttpResponseCachePolicyDecision {
  readonly method: string;
  readonly policy: IHttpResponseCachePolicy | null;
  readonly reason: HttpResponseCacheReasonValue;
}

export interface IResolveHttpResponseCachePolicyOptions {
  readonly enabled: boolean;
  readonly strategy?: AdapterCacheStrategy;
  readonly tenantId: string;
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

/**
 * Computes a stable cache key for a fully materialized HTTP request.
 *
 * The key is tenant-scoped and can vary by method, selected headers,
 * filtered query params, and body hash. The function is pure so both
 * activities can resolve policy decisions before invoking the cache.
 */
export function resolveHttpResponseCachePolicy(
  options: IResolveHttpResponseCachePolicyOptions,
): IHttpResponseCachePolicyDecision {
  const method = options.method.toUpperCase();
  if (!options.enabled) {
    return createBypassHttpResponseCacheDecision(
      method,
      HttpResponseCacheReason.FLAG_OFF,
    );
  }

  const strategy = options.strategy;
  if (!strategy?.enabled) {
    return createBypassHttpResponseCacheDecision(
      method,
      HttpResponseCacheReason.DISABLED,
    );
  }

  const allowedMethods = normalizeAllowedMethods(strategy);
  if (!allowedMethods.has(method)) {
    return createBypassHttpResponseCacheDecision(
      method,
      HttpResponseCacheReason.METHOD,
    );
  }

  const ttlSeconds = Math.max(1, Math.trunc(strategy.ttlSeconds));
  const canonicalUrl = canonicalizeUrl(options.url, strategy.keyQueryParams);
  const headerParts = buildHeaderKeyParts(options.headers, strategy.keyHeaders);
  const bodyPart = buildBodyKeyPart(method, strategy.keyBody, options.body);
  const keyPayload = JSON.stringify([
    options.tenantId,
    method,
    canonicalUrl,
    headerParts,
    bodyPart,
  ]);
  const key = `httpcache:v1:${createHash("sha256").update(keyPayload).digest("hex")}`;

  return {
    method,
    policy: { key, ttlSeconds },
    reason: HttpResponseCacheReason.OK,
  };
}

export function createBypassHttpResponseCacheDecision(
  method: string,
  reason: HttpResponseCacheReasonValue,
): IHttpResponseCachePolicyDecision {
  return {
    method: method.toUpperCase(),
    policy: null,
    reason,
  };
}

function normalizeAllowedMethods(
  strategy: AdapterCacheStrategy,
): ReadonlyMap<string, true> {
  const allowed = new Map<string, true>();
  const methods =
    strategy.methods && strategy.methods.length > 0
      ? strategy.methods
      : DEFAULT_CACHE_METHODS;
  for (let i = 0; i < methods.length; i++) {
    allowed.set(methods[i]!.toUpperCase(), true);
  }
  return allowed;
}

function canonicalizeUrl(
  rawUrl: string,
  keyQueryParams: string[] | typeof AdapterCacheQueryParamsMode.ALL | undefined,
): string {
  const parsed = new URL(rawUrl);
  parsed.hash = "";

  const nextParams = new URLSearchParams();
  const selectedNames =
    keyQueryParams === undefined || keyQueryParams === AdapterCacheQueryParamsMode.ALL
      ? null
      : new Set(keyQueryParams);

  const entries = [...parsed.searchParams.entries()]
    .filter(([name]) => selectedNames === null || selectedNames.has(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName === rightName) {
        return leftValue.localeCompare(rightValue);
      }
      return leftName.localeCompare(rightName);
    });

  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i]!;
    nextParams.append(name, value);
  }

  parsed.search = nextParams.toString();
  return parsed.toString();
}

function buildHeaderKeyParts(
  headers: Record<string, string>,
  keyHeaders: string[] | undefined,
): string[] {
  if (!keyHeaders || keyHeaders.length === 0) {
    return [];
  }

  const normalizedHeaders = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders.set(key.toLowerCase(), value);
  }

  const normalizedNames = [...keyHeaders]
    .map((name) => name.toLowerCase())
    .sort((left, right) => left.localeCompare(right));

  const parts: string[] = [];
  for (let i = 0; i < normalizedNames.length; i++) {
    const name = normalizedNames[i]!;
    parts.push(`${name}:${normalizedHeaders.get(name) ?? ""}`);
  }
  return parts;
}

function buildBodyKeyPart(
  method: string,
  keyBody: boolean | undefined,
  body: string | undefined,
): string {
  const normalizedMethod = method.toUpperCase() as AdapterCacheMethodValue;
  const shouldKeyBody = keyBody ?? METHODS_WITH_BODY_KEY.has(normalizedMethod);
  if (!shouldKeyBody) {
    return "";
  }
  return createHash("sha256").update(body ?? "").digest("hex");
}
