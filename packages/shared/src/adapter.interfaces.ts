export const AdapterCacheMethod = {
  GET: "GET",
  HEAD: "HEAD",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

export type AdapterCacheMethodValue =
  (typeof AdapterCacheMethod)[keyof typeof AdapterCacheMethod];

export const AdapterCacheQueryParamsMode = {
  ALL: "all",
} as const;

export type AdapterCacheQueryParamsModeValue =
  (typeof AdapterCacheQueryParamsMode)[keyof typeof AdapterCacheQueryParamsMode];

export interface IAdapterHeaderEntry {
  key: string;
  value: string;
}

export interface AdapterCacheStrategy {
  enabled: boolean;
  ttlSeconds: number;
  methods?: AdapterCacheMethodValue[];
  keyHeaders?: string[];
  keyQueryParams?: string[] | AdapterCacheQueryParamsModeValue;
  keyBody?: boolean;
}

export interface AdapterEndpointConfig {
  id: string;
  adapterId: string;
  label: string;
  method: string;
  path: string;
  cache?: AdapterCacheStrategy;
}

export const AdapterStatus = {
  ENABLED: "enabled",
  DISABLED: "disabled",
} as const;

export type AdapterStatusValue =
  (typeof AdapterStatus)[keyof typeof AdapterStatus];

export interface AdapterConfig {
  id: string;
  tenantId: string;
  name: string;
  context: string;
  baseUrl: string;
  authType: string;
  authConfig: Record<string, unknown>;
  headers: IAdapterHeaderEntry[];
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
  status: AdapterStatusValue;
  tags: string[];
  defaultCache?: AdapterCacheStrategy;
  endpoints: AdapterEndpointConfig[];
}

export interface ResolvedAdapterRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  cache?: AdapterCacheStrategy;
}

export interface AdapterReference {
  adapterId: string;
  endpointId: string;
}

/**
 * Minimal cache contract compatible with ioredis.
 * Services pass their Redis client directly -- no wrapper needed.
 */
export interface AdapterCache {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}
