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
