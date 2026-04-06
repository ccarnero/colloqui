import { TENANT_HEADER } from "@yoizen/shared";
import { HOST_PATTERN } from "../constants";

/**
 * Resolves tenant id from host subdomain, `x-yoizen-tenant`, or `?tenant=`.
 * Order matches {@link TenantGuard} (host → header → query). O(1).
 */
export function resolveTenantIdFromHttpRequest(
  headers: { host?: string; [key: string]: unknown },
  query: unknown,
): string | null {
  const host = headers.host ?? "";
  const hostMatch = HOST_PATTERN.exec(host);
  if (hostMatch) return hostMatch[1];

  const rawHeader = headers[TENANT_HEADER];
  const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (typeof header === "string" && header.length > 0) return header;

  const q = query as { tenant?: unknown };
  const queryTenant = q.tenant;
  if (typeof queryTenant === "string" && queryTenant.length > 0) {
    return queryTenant;
  }
  return null;
}
