export type AuthType = "none" | "api-key" | "bearer" | "basic" | "oauth2";

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

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface IHttpAdapterEndpoint {
  label: string;
  method: HttpMethod;
  path: string;
}

export interface IHttpAdapter {
  name: string;
  baseUrl: string;
  auth: IHttpAdapterAuth;
  headers: IHttpAdapterHeader[];
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
