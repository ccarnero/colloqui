export type TenantTier = "free" | "pro" | "enterprise";

export interface TenantStreamLimits {
  max_age: number;
  max_bytes: number;
  max_msg_size: number;
  num_replicas: number;
  object_store_max_bytes: number;
}

export interface TenantStreamConfig {
  name: string;
  subjects: string[];
  limits: TenantStreamLimits;
  tier: TenantTier;
}

const DAY_NS = 24 * 60 * 60 * 1_000_000_000;

export const TENANT_TIER_LIMITS: Record<TenantTier, TenantStreamLimits> = {
  free: {
    max_age: 7 * DAY_NS,
    max_bytes: 1_073_741_824,
    max_msg_size: 1_048_576,
    num_replicas: 1,
    object_store_max_bytes: 536_870_912,
  },
  pro: {
    max_age: 14 * DAY_NS,
    max_bytes: 5_368_709_120,
    max_msg_size: 1_048_576,
    num_replicas: 1,
    object_store_max_bytes: 2_147_483_648,
  },
  enterprise: {
    max_age: 30 * DAY_NS,
    max_bytes: 21_474_836_480,
    max_msg_size: 1_048_576,
    num_replicas: 3,
    object_store_max_bytes: 5_368_709_120,
  },
};

export function getTenantStreamName(tenantId: string): string {
  return `INGRESS-${tenantId.toUpperCase()}`;
}

export function getTenantSubjectPattern(tenantId: string): string {
  return `evt.${tenantId}.>`;
}

export function buildTenantStreamConfig(
  tenantId: string,
  tier: TenantTier,
): TenantStreamConfig {
  return {
    name: getTenantStreamName(tenantId),
    subjects: [getTenantSubjectPattern(tenantId)],
    limits: TENANT_TIER_LIMITS[tier],
    tier,
  };
}

export interface JetStreamStorageCheck {
  ok: boolean;
  requestedBytes: number;
  availableBytes: number;
  message?: string;
}

/**
 * Validates that requested stream storage fits within available
 * JetStream file capacity. Call with values from
 * `jsm.getAccountInfo()` before creating streams.
 *
 * @param requestedMaxBytes - max_bytes for the new stream
 * @param storageUsed - current file storage used (accountInfo.storage)
 * @param storageLimit - file storage limit (accountInfo.limits.max_storage), -1 = unlimited
 */
export function checkJetStreamCapacity(
  requestedMaxBytes: number,
  storageUsed: number,
  storageLimit: number,
): JetStreamStorageCheck {
  if (storageLimit < 0) {
    return {
      ok: true,
      requestedBytes: requestedMaxBytes,
      availableBytes: -1,
    };
  }

  const available = storageLimit - storageUsed;
  if (requestedMaxBytes > available) {
    return {
      ok: false,
      requestedBytes: requestedMaxBytes,
      availableBytes: available,
      message:
        `Insufficient JetStream file storage: ` +
        `need ${requestedMaxBytes} bytes but only ` +
        `${available} bytes available ` +
        `(${storageUsed}/${storageLimit} used)`,
    };
  }

  return {
    ok: true,
    requestedBytes: requestedMaxBytes,
    availableBytes: available,
  };
}
