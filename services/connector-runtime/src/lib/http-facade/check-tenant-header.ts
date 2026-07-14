// Tenant guard for the HTTP invoke facade (`manual-loops/connector-invoke-api.md`
// T02). Same header contract as the gateway-proxied services (e.g.
// `tracking-ingester-service`'s `handle-events-request.ts`): the gateway
// proxy always sets `x-yoizen-tenant`; a missing/blank header means the
// request bypassed the gateway and MUST be rejected — no unauthenticated
// access to connector-runtime's new HTTP surface (SPEC.md T02 constraint).

import { TENANT_HEADER } from "@yoizen/shared";

export type TenantGuardResult =
  | { readonly ok: true; readonly tenantId: string }
  | {
      readonly ok: false;
      readonly status: 400;
      readonly body: { readonly error: string };
    };

/**
 * Validates the `x-yoizen-tenant` header value. `headerValue` is whatever
 * `Request.headers.get(TENANT_HEADER)` returned (`null` when absent).
 */
export function checkTenantHeader(
  headerValue: string | null
): TenantGuardResult {
  if (headerValue === null || headerValue.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: `missing ${TENANT_HEADER} header` },
    };
  }
  return { ok: true, tenantId: headerValue };
}
