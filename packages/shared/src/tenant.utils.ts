import { TENANT_HEADER } from "./constants";

const TENANT_ID_PATTERN = /^[a-zA-Z0-9-]{3,32}$/;

export function extractTenantId(headers: Record<string, string>): string | null {
  const normalizedKey = TENANT_HEADER.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedKey) {
      return headers[key];
    }
  }
  return null;
}

export function validateTenantId(tenantId: string): boolean {
  return TENANT_ID_PATTERN.test(tenantId);
}

const ROW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Distinguish platform tenant table UUID from DNS tenant name in `GET /tenants/:param`.
 * Name max length 32; row ids are 36 characters.
 */
export function isPlatformTenantRowIdParam(s: string): boolean {
  return s.length === 36 && ROW_UUID_RE.test(s);
}
