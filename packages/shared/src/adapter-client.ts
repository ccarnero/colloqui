import { applyAdapterAuthHeadersSync } from "./adapter-auth-headers";
import { TENANT_HEADER } from "./constants";
import type {
  AdapterCache,
  AdapterConfig,
  ResolvedAdapterRequest,
} from "./adapter.interfaces";

interface CachedAdapter {
  data: AdapterConfig;
  softExpiresAt: number;
}

interface CachedInternalLookup {
  /** `null` means "no mirror exists" — negative caching to avoid repeated 404s. */
  data: AdapterConfig | null;
  softExpiresAt: number;
}

const DEFAULT_CACHE_TTL_S = 60;
const STALE_MULTIPLIER = 5;
const OAUTH_TOKEN_BUFFER_S = 30;
const ADAPTER_KEY_PREFIX = "adapter:config:";
const OAUTH_KEY_PREFIX = "adapter:oauth:";
const INTERNAL_BY_SERVICE_KEY_PREFIX = "adapter:internal-by-service:";
/** Shorter negative-cache TTL: new mirrors should propagate fast. */
const NEGATIVE_CACHE_TTL_S = 10;

export interface AdapterClientOptions {
  baseUrl: string;
  fetchFn: typeof globalThis.fetch;
  cache: AdapterCache;
  cacheTtlSeconds?: number;
}

export class AdapterClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly cache: AdapterCache;
  private readonly cacheTtlS: number;

  constructor(opts: AdapterClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn;
    this.cache = opts.cache;
    this.cacheTtlS = opts.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_S;
  }

  /**
   * Fetches an adapter config by ID with stale-while-revalidate caching.
   * Soft TTL controls refresh attempts; hard TTL (5x soft) keeps stale data
   * available in Redis as a fallback when adapter-service is unreachable.
   */
  async getAdapter(
    tenantId: string,
    adapterId: string,
  ): Promise<AdapterConfig> {
    const key = `${ADAPTER_KEY_PREFIX}${tenantId}:${adapterId}`;
    const raw = await this.cache.get(key);

    if (raw) {
      const entry = JSON.parse(raw) as CachedAdapter;
      if (Date.now() < entry.softExpiresAt) {
        return entry.data;
      }
      return this.refreshOrStale(tenantId, adapterId, key, entry.data);
    }

    return this.fetchAndCache(tenantId, adapterId, key);
  }

  /**
   * Resolves a fully-constructed request from an adapter + endpoint.
   * Builds the URL, injects auth headers, merges custom headers.
   */
  async resolveRequest(
    tenantId: string,
    adapterId: string,
    endpointId: string,
  ): Promise<ResolvedAdapterRequest> {
    let adapter = await this.getAdapter(tenantId, adapterId);
    let endpoint = adapter.endpoints.find((ep) => ep.id === endpointId);

    if (!endpoint) {
      await this.invalidate(tenantId, adapterId);
      adapter = await this.getAdapter(tenantId, adapterId);
      endpoint = adapter.endpoints.find((ep) => ep.id === endpointId);
    }

    if (!endpoint) {
      throw new Error(
        `Endpoint '${endpointId}' not found on adapter '${adapterId}'`,
      );
    }

    const base = adapter.baseUrl.replace(/\/+$/, "");
    const path = endpoint.path.startsWith("/")
      ? endpoint.path
      : `/${endpoint.path}`;

    const headers: Record<string, string> = {};

    for (const h of adapter.headers) {
      headers[h.key] = h.value;
    }

    await this.injectAuthHeaders(adapter, headers);

    return {
      url: `${base}${path}`,
      method: endpoint.method,
      headers,
      timeoutMs: adapter.timeoutMs,
      maxRetries: adapter.maxRetries,
      retryBackoffMs: adapter.retryBackoffMs,
    };
  }

  async invalidate(tenantId: string, adapterId: string): Promise<void> {
    const key = `${ADAPTER_KEY_PREFIX}${tenantId}:${adapterId}`;
    await this.cache.del(key);
  }

  async invalidateOAuthToken(adapterId: string): Promise<void> {
    await this.cache.del(`${OAUTH_KEY_PREFIX}${adapterId}`);
  }

  async invalidateInternalByServiceId(
    tenantId: string,
    serviceId: string,
  ): Promise<void> {
    const key = `${INTERNAL_BY_SERVICE_KEY_PREFIX}${tenantId}:${serviceId}`;
    await this.cache.del(key);
  }

  /**
   * Finds the internal-adapter mirror for a given `serviceId` (the name
   * of a service registered in `registry-service`). The adapter-service
   * materializes one adapter per registered service with `context=internal`
   * and `name=serviceId`.
   *
   * Returns `null` when no mirror exists. Caller can fall back to the
   * legacy registry-service resolution path. Both hits and misses are
   * cached to keep the hot path O(1) against Redis.
   *
   * SWR behaviour mirrors {@link getAdapter}: soft TTL drives refresh
   * attempts; stale data (or cached null) stays available as fallback.
   */
  async findInternalByServiceId(
    tenantId: string,
    serviceId: string,
  ): Promise<AdapterConfig | null> {
    const key = `${INTERNAL_BY_SERVICE_KEY_PREFIX}${tenantId}:${serviceId}`;
    const raw = await this.cache.get(key);

    if (raw) {
      const entry = JSON.parse(raw) as CachedInternalLookup;
      if (Date.now() < entry.softExpiresAt) {
        return entry.data;
      }
      return this.refreshInternalOrStale(tenantId, serviceId, key, entry.data);
    }

    return this.fetchAndCacheInternal(tenantId, serviceId, key);
  }

  /**
   * Resolves a request for an internal service through its adapter
   * mirror. Hybrid model:
   *  - If `opts.endpointId` is provided, the adapter endpoint's method
   *    and path are used (strict endpoint-based resolution).
   *  - Otherwise, `opts.path` is concatenated onto `adapter.baseUrl` and
   *    `opts.method` is honoured verbatim (dynamic-path mode).
   *
   * Returns `null` when no mirror exists so the caller can fall back.
   */
  async resolveForInternalService(
    tenantId: string,
    serviceId: string,
    opts: { endpointId?: string; path?: string; method?: string },
  ): Promise<ResolvedAdapterRequest | null> {
    const adapter = await this.findInternalByServiceId(tenantId, serviceId);
    if (!adapter) return null;

    if (opts.endpointId) {
      return this.resolveRequest(tenantId, adapter.id, opts.endpointId);
    }

    const base = adapter.baseUrl.replace(/\/+$/, "");
    const rawPath = opts.path ?? "";
    const path = rawPath.length === 0 || rawPath.startsWith("/")
      ? rawPath
      : `/${rawPath}`;

    const headers: Record<string, string> = {};
    for (let i = 0; i < adapter.headers.length; i++) {
      const h = adapter.headers[i]!;
      headers[h.key] = h.value;
    }
    await this.injectAuthHeaders(adapter, headers);

    return {
      url: `${base}${path}`,
      method: opts.method ?? "GET",
      headers,
      timeoutMs: adapter.timeoutMs,
      maxRetries: adapter.maxRetries,
      retryBackoffMs: adapter.retryBackoffMs,
    };
  }

  private async refreshOrStale(
    tenantId: string,
    adapterId: string,
    key: string,
    staleData: AdapterConfig,
  ): Promise<AdapterConfig> {
    try {
      return await this.fetchAndCache(tenantId, adapterId, key);
    } catch {
      return staleData;
    }
  }

  private async refreshInternalOrStale(
    tenantId: string,
    serviceId: string,
    key: string,
    staleData: AdapterConfig | null,
  ): Promise<AdapterConfig | null> {
    try {
      return await this.fetchAndCacheInternal(tenantId, serviceId, key);
    } catch {
      return staleData;
    }
  }

  private async fetchAndCacheInternal(
    tenantId: string,
    serviceId: string,
    key: string,
  ): Promise<AdapterConfig | null> {
    const config = await this.fetchInternalByServiceId(tenantId, serviceId);
    const ttlS = config ? this.cacheTtlS : NEGATIVE_CACHE_TTL_S;
    const entry: CachedInternalLookup = {
      data: config,
      softExpiresAt: Date.now() + ttlS * 1_000,
    };
    const hardTtl = ttlS * STALE_MULTIPLIER;
    await this.cache.setex(key, hardTtl, JSON.stringify(entry));
    return config;
  }

  /**
   * Lists internal adapters filtered by `name=serviceId` and returns the
   * first match (there should be at most one since `(tenant_id, name)`
   * is unique). Returns `null` when none exists — caller caches that
   * as a negative hit.
   */
  private async fetchInternalByServiceId(
    tenantId: string,
    serviceId: string,
  ): Promise<AdapterConfig | null> {
    const qs = new URLSearchParams({
      context: "internal",
      name: serviceId,
      limit: "1",
    });
    const url = `${this.baseUrl}/adapters?${qs.toString()}`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: {
        [TENANT_HEADER]: tenantId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to list internal adapters for service '${serviceId}': HTTP ${res.status}`,
      );
    }

    const list = (await res.json()) as AdapterConfig[];
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[0]!;
  }

  private async fetchAndCache(
    tenantId: string,
    adapterId: string,
    key: string,
  ): Promise<AdapterConfig> {
    const config = await this.fetchAdapter(tenantId, adapterId);
    const entry: CachedAdapter = {
      data: config,
      softExpiresAt: Date.now() + this.cacheTtlS * 1_000,
    };
    const hardTtl = this.cacheTtlS * STALE_MULTIPLIER;
    await this.cache.setex(key, hardTtl, JSON.stringify(entry));
    return config;
  }

  private async fetchAdapter(
    tenantId: string,
    adapterId: string,
  ): Promise<AdapterConfig> {
    const url = `${this.baseUrl}/adapters/${encodeURIComponent(adapterId)}`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: {
        [TENANT_HEADER]: tenantId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch adapter '${adapterId}': HTTP ${res.status}`,
      );
    }

    return (await res.json()) as AdapterConfig;
  }

  private async injectAuthHeaders(
    adapter: AdapterConfig,
    headers: Record<string, string>,
  ): Promise<void> {
    applyAdapterAuthHeadersSync(adapter, headers);
    if (adapter.authType === "oauth2") {
      const token = await this.getOAuthToken(adapter);
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  private async getOAuthToken(adapter: AdapterConfig): Promise<string> {
    const key = `${OAUTH_KEY_PREFIX}${adapter.id}`;
    const cached = await this.cache.get(key);

    if (cached) {
      return cached;
    }

    const tokenUrl = adapter.authConfig.oauth2TokenUrl as string;
    const clientId = adapter.authConfig.oauth2ClientId as string;
    const clientSecret = adapter.authConfig.oauth2ClientSecret as string;

    const res = await this.fetchFn(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(
        `OAuth2 token request failed for adapter '${adapter.id}': HTTP ${res.status}`,
      );
    }

    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    const ttlSeconds = Math.max(body.expires_in - OAUTH_TOKEN_BUFFER_S, 1);
    await this.cache.setex(key, ttlSeconds, body.access_token);

    return body.access_token;
  }
}

/**
 * Shared wiring for services and workers: {@link AdapterClient} with Redis cache
 * and a custom fetch (e.g. `tracedFetch` from `@yoizen/observability`).
 */
export function createAdapterClientWithRedisAndFetch(
  baseUrl: string,
  cache: AdapterClientOptions["cache"],
  fetchFn: AdapterClientOptions["fetchFn"],
): AdapterClient {
  return new AdapterClient({ baseUrl, cache, fetchFn });
}
