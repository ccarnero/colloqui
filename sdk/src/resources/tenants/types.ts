/**
 * Request/response types for the `tenants` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04; messagingTier surface re-verified 2026-08-01, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/tenants/tenants.controller.ts` (+
 *   `tenants.dto.ts`, `tenant-proxy.service.ts`) — `@SkipTenant()`
 *   controller, pure JSON passthrough to `tenant-service` (no reshaping).
 * - `services/tenant-service/src/modules/tenants/tenants.service.ts` defines
 *   the real response shapes (`ITenantSummary`, `ITenantDetail`,
 *   `ICreateTenantAccepted`).
 *
 * Confirmed gateway route-param ASYMMETRY (not a typo — both are real):
 * - `GET /tenants/:nameOrId` resolves by platform row UUID OR tenant name.
 * - `PATCH /tenants/:name` and `DELETE /tenants/:name` resolve by name ONLY.
 * This SDK's `get()` takes a `nameOrId` parameter; `update()`/`remove()` take
 * a `name` parameter — mirroring the gateway's own inconsistency rather than
 * papering over it (GROWTH-PLAN.md working agreement #4: gateway
 * inconsistencies get documented, not silently normalized client-side).
 *
 * Other notes:
 * - `POST /tenants` returns 202 Accepted (`ICreateTenantAccepted`) —
 *   provisioning is asynchronous; the response includes a `statusUrl` for
 *   polling, not a fully-provisioned tenant.
 * - `GET /tenants` returns a BARE ARRAY of `ITenantSummary` — no
 *   `limit`/`offset`, no envelope. Degraded to a single page via
 *   `toSinglePage()`.
 * - `PATCH /tenants/:name` takes `configuration` and/or `messagingTier`
 *   (both optional since 2026-08-01, tenant-messaging-tiers T01/T04; a body
 *   with neither is a 400). `configuration` is a full object treated as
 *   merge/replace, not a per-field patch; a `messagingTier` change
 *   reconciles the tenant's live INGRESS stream and returns 409 when the
 *   new tier would shrink `max_bytes` below current stream usage.
 * - Tenant creation provisions REAL infrastructure downstream (namespaces,
 *   DB schemas per `ITenantDetail.namespaces`/`mongoHost`/`postgresHost`) —
 *   this is NOT a cheap/throwaway operation. See the e2e file for how this
 *   resource's mutation coverage was scoped down accordingly.
 */

export type TenantDatabaseTier = "shared" | "dedicated";
/** Messaging tier governing the tenant's INGRESS stream limits. */
export type TenantMessagingTier = "free" | "pro" | "enterprise";
export type ProvisioningStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "failed";

/** `POST /tenants` body. */
export interface CreateTenantInput {
  /** Lowercase alphanumeric + hyphen, max 32 chars, e.g. `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. */
  name: string;
  tier?: TenantDatabaseTier;
  /** Defaults to `free` downstream. */
  messagingTier?: TenantMessagingTier;
  configuration?: Record<string, unknown>;
}

/**
 * `PATCH /tenants/:name` body — both fields optional, at least one required
 * (400 otherwise). `configuration` is a full object (merge/replace, not a
 * per-field patch); `messagingTier` changes reconcile the live INGRESS
 * stream (409 on a shrink below current usage).
 */
export interface UpdateTenantInput {
  configuration?: Record<string, unknown>;
  messagingTier?: TenantMessagingTier;
}

/** `GET /tenants` list row. */
export interface TenantSummary {
  id: string;
  name: string;
  environment: string;
  configuration: Record<string, unknown>;
  provisioningStatus: ProvisioningStatus;
  tier: TenantDatabaseTier;
  messagingTier: TenantMessagingTier;
}

/** `GET /tenants/:nameOrId` / `PATCH /tenants/:name` response. */
export interface TenantDetail {
  id: string;
  name: string;
  tier: TenantDatabaseTier;
  messagingTier: TenantMessagingTier;
  configuration: Record<string, unknown>;
  namespaces: Array<{ name: string; status: string }>;
  mongoHost?: string;
  postgresHost?: string;
  provisioningStatus: ProvisioningStatus;
  provisioningError: string | null;
  /** ISO-8601 timestamp, or `null` before provisioning starts. */
  provisioningStartedAt: string | null;
  /** ISO-8601 timestamp, or `null` before provisioning completes. */
  provisioningCompletedAt: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/** `POST /tenants` response (202 Accepted) — provisioning is async. */
export interface CreateTenantAccepted {
  id: string;
  name: string;
  tier: TenantDatabaseTier;
  messagingTier: TenantMessagingTier;
  provisioningStatus: ProvisioningStatus;
  /** Poll this URL (or `get(name)`) for provisioning completion. */
  statusUrl: string;
}
