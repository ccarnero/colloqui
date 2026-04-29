import type { JsonValue } from "./interfaces";
import { TenantDatabaseTier, isTenantDatabaseTier } from "./tenant-database-tier";
import type { TenantDatabaseTierValue } from "./tenant-database-tier";

/**
 * Provisioning state for a tenant in the platform database.
 * O(1) string equality checks; use {@link isProvisioningStatus} to narrow.
 */
export const ProvisioningStatus = {
  Pending: "pending",
  Provisioning: "provisioning",
  Ready: "ready",
  Failed: "failed",
} as const;

export type ProvisioningStatusValue =
  (typeof ProvisioningStatus)[keyof typeof ProvisioningStatus];

const PROVISIONING_STATUS_SET: ReadonlySet<string> = new Set(
  Object.values(ProvisioningStatus),
);

export function isProvisioningStatus(
  s: string,
): s is ProvisioningStatusValue {
  return PROVISIONING_STATUS_SET.has(s);
}

/** JetStream stream for platform-scoped tenant lifecycle messages. */
export const PLATFORM_TENANTS_STREAM_NAME = "PLATFORM_TENANTS" as const;

/** Stream matches all `platform.tenant.*` subjects. */
export const PLATFORM_TENANTS_SUBJECT_PATTERN = "platform.tenant.>" as const;

/**
 * Enqueued when POST /tenants creates a row; a durable consumer
 * in tenant-service provisions namespace + per-tenant Postgres.
 */
export const TENANT_PROVISION_REQUESTED_SUBJECT =
  "platform.tenant.provision.requested" as const;

export const TENANT_PROVISIONER_DURABLE = "tenant-provisioner" as const;

/** NATS `max_deliver` for the provision durable (must be > backoff.length). */
export const TENANT_PROVISION_MAX_DELIVER = 5;

/**
 * v1 message body (JSON) published to {@link TENANT_PROVISION_REQUESTED_SUBJECT}.
 * Idempotency: JetStream `Nats-Msg-Id` = `tenantId`.
 */
export type TenantProvisionRequestedMessageV1 = {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly name: string;
  readonly configuration: Readonly<Record<string, JsonValue>>;
};

export function isTenantProvisionRequestedMessageV1(
  v: unknown,
): v is TenantProvisionRequestedMessageV1 {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== 1) return false;
  if (typeof o.tenantId !== "string" || o.tenantId.length < 1) return false;
  if (typeof o.name !== "string" || o.name.length < 1) return false;
  if (o.configuration === null || typeof o.configuration !== "object" || Array.isArray(o.configuration)) {
    return false;
  }
  return true;
}

/**
 * Best-effort fan-out subject (Core NATS, NOT JetStream) emitted by
 * `tenant-service` immediately after `markProvisioningReady` flips the
 * platform DB row from `provisioning` → `ready` (i.e. the per-tenant
 * Postgres + namespace are usable).
 *
 * Subscribers use it to **proactively** run per-tenant migrations and
 * pre-warm pools before the first HTTP request hits them. The lazy
 * `TenantConnectionManager.ensureSchema(tenantId)` path remains the
 * source of truth — a missed message just means the first request
 * after creation pays the DDL cost on the synchronous path. That's why
 * Core NATS (broadcast, no replay) is sufficient and JetStream's
 * durability isn't needed.
 */
export const TENANT_READY_SUBJECT = "platform.tenant.ready" as const;

/**
 * v1 message body for {@link TENANT_READY_SUBJECT}.
 * `tier` is best-effort metadata — receivers MUST tolerate it being
 * absent (older publishers, replay) and treat it as "ensure schema for
 * this tenant against the catalog-resolved DB regardless of tier".
 */
export type TenantReadyMessageV1 = {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly name: string;
  readonly tier?: TenantDatabaseTierValue;
};

export function isTenantReadyMessageV1(
  v: unknown,
): v is TenantReadyMessageV1 {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== 1) return false;
  if (typeof o.tenantId !== "string" || o.tenantId.length < 1) return false;
  if (typeof o.name !== "string" || o.name.length < 1) return false;
  if (o.tier !== undefined && (typeof o.tier !== "string" || !isTenantDatabaseTier(o.tier))) {
    return false;
  }
  return true;
}

/**
 * Best-effort fan-out subject (Core NATS, NOT JetStream) emitted by
 * `tenant-service` immediately after the `DELETE /tenants/:name`
 * cascade finishes its infra cleanup.
 *
 * Why Core NATS instead of the existing `PLATFORM_TENANTS` Workqueue
 * stream: every long-lived service replica that caches a per-tenant
 * Postgres pool needs to receive this — Workqueue retention delivers
 * each message to **one** consumer, which would defeat fan-out.
 * Misses (replica restart between publish and subscribe, broker
 * reconnect) are recovered by the self-healing branch in
 * `TenantConnectionManager.verifyConnectivity`.
 */
export const TENANT_DELETED_SUBJECT = "platform.tenant.deleted" as const;

/**
 * v1 message body for {@link TENANT_DELETED_SUBJECT}.
 * `tier` is best-effort metadata — receivers MUST tolerate it being
 * absent (older publishers, message replay) and treat it as "evict
 * any pool keyed by this tenant regardless of tier".
 */
export type TenantDeletedMessageV1 = {
  readonly schemaVersion: 1;
  readonly tenantId: string;
  readonly name: string;
  readonly tier?: TenantDatabaseTierValue;
};

export function isTenantDeletedMessageV1(
  v: unknown,
): v is TenantDeletedMessageV1 {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== 1) return false;
  if (typeof o.tenantId !== "string" || o.tenantId.length < 1) return false;
  if (typeof o.name !== "string" || o.name.length < 1) return false;
  if (o.tier !== undefined && (typeof o.tier !== "string" || !isTenantDatabaseTier(o.tier))) {
    return false;
  }
  return true;
}

// Re-export so callers building a {@link TenantDeletedMessageV1} don't
// need a parallel import from `./tenant-database-tier`.
export { TenantDatabaseTier };
