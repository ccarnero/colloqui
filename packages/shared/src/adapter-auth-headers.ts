import type { AdapterConfig } from "./adapter.interfaces";

/**
 * Applies adapter auth headers for types that do not require async token fetch
 * (`none`, `api-key`, `bearer`, `basic`). For `oauth2`, use {@link AdapterClient}
 * `resolveRequest` or compose with an async token provider.
 */
export function applyAdapterAuthHeadersSync(
  adapter: AdapterConfig,
  headers: Record<string, string>,
): void {
  const { authType, authConfig } = adapter;

  switch (authType) {
    case "none":
      return;

    case "api-key": {
      const apiKey = authConfig.apiKey as string;
      const headerName =
        (authConfig.apiKeyHeader as string) ?? "X-API-Key";
      headers[headerName] = apiKey;
      return;
    }

    case "bearer": {
      headers["Authorization"] = `Bearer ${authConfig.bearerToken as string}`;
      return;
    }

    case "basic": {
      const user = authConfig.basicUsername as string;
      const pass = authConfig.basicPassword as string;
      headers["Authorization"] = `Basic ${btoa(`${user}:${pass}`)}`;
      return;
    }

    case "oauth2":
      return;

    default:
      return;
  }
}
