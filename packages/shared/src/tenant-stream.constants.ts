export const TENANT_TIERS = ["free", "pro", "enterprise"] as const;
export type TenantTier = (typeof TENANT_TIERS)[number];

/** Type guard mirroring `isTenantDatabaseTier` for the messaging tier. */
export function isTenantTier(value: unknown): value is TenantTier {
  return (TENANT_TIERS as readonly unknown[]).includes(value);
}

/**
 * Default messaging tier for tenants that never had one assigned — including
 * every tenant document/row created before the field existed (absent reads
 * as `free`; see `manual-loops/messaging/tenant-messaging-tiers.md`
 * decision 1).
 */
export const DEFAULT_TENANT_MESSAGING_TIER: TenantTier = "free";

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

/**
 * LIVE since 2026-08-01 (tenant-messaging-tiers T02): the provisioning
 * executor applies `TENANT_TIER_LIMITS[messaging_tier]` — clamped by
 * `clampTenantStreamLimits` with the environment ceilings — when it creates
 * `INGRESS-<TENANT>`. Every OTHER `ensureTenantIngressStream` call site is a
 * lazy-ensure fallback that still uses the flat
 * `CHANNEL_STREAM_MAX_AGE_NS` / `CHANNEL_STREAM_MAX_BYTES` (SPEC decision 2)
 * and no-ops once the stream exists. Applying a tier to an EXISTING stream is
 * the T04 reconciliation path. `object_store_max_bytes` is carried here but
 * not wired anywhere (SPEC decision 5: claim-check stays flat).
 */
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

/**
 * RESERVED FOR A FUTURE DESIGN — see `DOCS/v_next/tenant-messaging-tiers.md`.
 *
 * Had two callers (agent-admin, agent-memory) that both hardcoded
 * `tier: "free"`; both now delegate stream creation to
 * `ensureTenantIngressStream`, so this composes a config nothing applies yet.
 */
export function buildTenantStreamConfig(
  tenantId: string,
  tier: TenantTier
): TenantStreamConfig {
  return {
    name: getTenantStreamName(tenantId),
    subjects: [getTenantSubjectPattern(tenantId)],
    limits: TENANT_TIER_LIMITS[tier],
    tier,
  };
}

/**
 * Per-environment ceilings for tier limits
 * (`manual-loops/messaging/tenant-messaging-tiers.md` decision 3). The
 * environment never changes a tenant's tier — it CLAMPS the effective
 * limits so a `pro`/`enterprise` tenant in a small cluster gets what the
 * cluster can actually hold. Unset field = no clamp on that axis.
 */
export interface TenantStreamLimitCeilings {
  maxBytesCeiling?: number;
  maxReplicasCeiling?: number;
}

/** Environment variable names for {@link readMessagingCeilingsFromEnv}. */
export const MESSAGING_MAX_BYTES_CEILING_ENV = "MESSAGING_MAX_BYTES_CEILING";
export const MESSAGING_MAX_REPLICAS_CEILING_ENV =
  "MESSAGING_MAX_REPLICAS_CEILING";

/**
 * Parses the messaging ceilings from environment variables. Absent vars mean
 * "no clamp"; a set-but-invalid value (non-numeric or < 1) throws, because
 * silently ignoring a mistyped ceiling would deploy uncapped tier limits.
 */
export function readMessagingCeilingsFromEnv(
  env: Record<string, string | undefined> = process.env
): TenantStreamLimitCeilings {
  const read = (name: string): number | undefined => {
    const raw = env[name];
    if (raw === undefined || raw === "") {
      return undefined;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `${name} must be a positive integer, got: ${JSON.stringify(raw)}`
      );
    }
    return value;
  };
  return {
    maxBytesCeiling: read(MESSAGING_MAX_BYTES_CEILING_ENV),
    maxReplicasCeiling: read(MESSAGING_MAX_REPLICAS_CEILING_ENV),
  };
}

/**
 * Applies the environment ceilings to a tier's limits. Only `max_bytes` and
 * `num_replicas` clamp — retention age and message size are policy, not
 * capacity, and stay tier-defined. Returns a new object; never mutates.
 */
export function clampTenantStreamLimits(
  limits: TenantStreamLimits,
  ceilings: TenantStreamLimitCeilings
): TenantStreamLimits {
  return {
    ...limits,
    max_bytes:
      ceilings.maxBytesCeiling === undefined
        ? limits.max_bytes
        : Math.min(limits.max_bytes, ceilings.maxBytesCeiling),
    num_replicas:
      ceilings.maxReplicasCeiling === undefined
        ? limits.num_replicas
        : Math.min(limits.num_replicas, ceilings.maxReplicasCeiling),
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
  storageLimit: number
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
