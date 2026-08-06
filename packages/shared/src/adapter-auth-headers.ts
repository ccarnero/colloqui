import type { AdapterConfig } from "./adapter.interfaces";

/**
 * Applies adapter auth headers for the four supported auth types
 * (`none`, `api-key`, `bearer`, `basic`).
 *
 * Any other value is unsupported: no header is injected and the call is
 * logged, so a connector stored with a stale/unknown `authType` cannot
 * silently issue unauthenticated requests.
 */
export function applyAdapterAuthHeadersSync(
  adapter: AdapterConfig,
  headers: Record<string, string>
): void {
  const { authType, authConfig } = adapter;

  switch (authType) {
    case "none":
      return;

    case "api-key": {
      const apiKey = authConfig.apiKey as string;
      const headerName = (authConfig.apiKeyHeader as string) ?? "X-API-Key";
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

    default:
      console.warn(
        `applyAdapterAuthHeadersSync: unsupported authType '${String(authType)}' ` +
          `on adapter '${adapter.id}' (tenant '${adapter.tenantId}') — ` +
          `no Authorization header injected. Supported: none, api-key, bearer, basic.`
      );
      return;
  }
}
