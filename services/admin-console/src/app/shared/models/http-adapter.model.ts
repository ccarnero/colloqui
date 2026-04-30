export type AuthType = "none" | "api-key" | "bearer" | "basic" | "oauth2";

export const HTTP_ADAPTER_METHOD = {
  GET: "GET",
  HEAD: "HEAD",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

export type HttpMethod =
  (typeof HTTP_ADAPTER_METHOD)[keyof typeof HTTP_ADAPTER_METHOD];

export const HTTP_ADAPTER_CACHE_QUERY_PARAMS_MODE = {
  ALL: "all",
} as const;

export type HttpAdapterCacheQueryParamsMode =
  (typeof HTTP_ADAPTER_CACHE_QUERY_PARAMS_MODE)[keyof typeof HTTP_ADAPTER_CACHE_QUERY_PARAMS_MODE];

export interface IHttpAdapterAuth {
  type: AuthType;
  apiKey?: string;
  apiKeyHeader?: string;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  oauth2TokenUrl?: string;
}

export interface IHttpAdapterHeader {
  key: string;
  value: string;
}

export interface IHttpAdapterCacheStrategy {
  enabled: boolean;
  ttlSeconds: number;
  methods?: HttpMethod[];
  keyHeaders?: string[];
  keyQueryParams?: string[] | HttpAdapterCacheQueryParamsMode;
  keyBody?: boolean;
}

export interface IHttpAdapterEndpoint {
  id?: string;
  label: string;
  method: HttpMethod;
  path: string;
  cache?: IHttpAdapterCacheStrategy;
}

export interface IHttpAdapter {
  name: string;
  baseUrl: string;
  auth: IHttpAdapterAuth;
  headers: IHttpAdapterHeader[];
  defaultCache?: IHttpAdapterCacheStrategy;
  endpoints: IHttpAdapterEndpoint[];
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
  tags: string[];
  isEncrypted: boolean;
}

export type IHttpAdapterContext = "internal" | "external";

export interface IHttpAdapterDialogData {
  mode: "create" | "edit";
  context?: IHttpAdapterContext;
  adapter?: IHttpAdapter;
}

export interface IHttpAdapterDialogResult {
  adapter: IHttpAdapter;
  context: IHttpAdapterContext;
}
