export interface AdapterEndpointConfig {
  id: string;
  adapterId: string;
  label: string;
  method: string;
  path: string;
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
  headers: Array<{ key: string; value: string }>;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
  status: AdapterStatusValue;
  endpoints: AdapterEndpointConfig[];
}

export interface ResolvedAdapterRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
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
