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

const DEFAULT_CACHE_TTL_S = 60;
const STALE_MULTIPLIER = 5;
const OAUTH_TOKEN_BUFFER_S = 30;
const ADAPTER_KEY_PREFIX = "adapter:config:";
const OAUTH_KEY_PREFIX = "adapter:oauth:";

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
