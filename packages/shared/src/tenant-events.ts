import type { JsonValue } from "./interfaces";

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
