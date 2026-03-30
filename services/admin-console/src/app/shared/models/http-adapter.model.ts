export type AuthType = "none" | "api-key" | "bearer" | "basic" | "oauth2";

export interface HttpAdapterAuth {
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

export interface HttpAdapterHeader {
  key: string;
  value: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpAdapterEndpoint {
  label: string;
  method: HttpMethod;
  path: string;
}

export interface HttpAdapter {
  name: string;
  baseUrl: string;
  auth: HttpAdapterAuth;
  headers: HttpAdapterHeader[];
  endpoints: HttpAdapterEndpoint[];
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
}

export type HttpAdapterContext = "internal" | "external";

export interface HttpAdapterDialogData {
  mode: "create" | "edit";
  context: HttpAdapterContext;
  adapter?: HttpAdapter;
}
