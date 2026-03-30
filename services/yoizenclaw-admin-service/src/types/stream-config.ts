import { calculateChecksum, checkPayloadSize, formatBytes } from "../utils/payload-utils";

export type TenantTier = "free" | "pro" | "enterprise";

export interface StreamLimits {
  max_age: number;
  max_bytes: number;
  max_msg_size: number;
  num_replicas: number;
}

export interface TenantStreamConfig {
  name: string;
  subjects: string[];
  limits: StreamLimits;
  tier: TenantTier;
}

const DAY_NS = 24 * 60 * 60 * 1_000_000_000;

export const TIER_CONFIGS: Record<TenantTier, StreamLimits> = {
  free: {
    max_age: 7 * DAY_NS,
    max_bytes: 1_073_741_824,
    max_msg_size: 1_048_576,
    num_replicas: 1,
  },
  pro: {
    max_age: 14 * DAY_NS,
    max_bytes: 5_368_709_120,
    max_msg_size: 1_048_576,
    num_replicas: 1,
  },
  enterprise: {
    max_age: 30 * DAY_NS,
    max_bytes: 21_474_836_480,
    max_msg_size: 1_048_576,
    num_replicas: 3,
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
    limits: TIER_CONFIGS[tier],
    tier,
  };
}

export { calculateChecksum, checkPayloadSize, formatBytes };
