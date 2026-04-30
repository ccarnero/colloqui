export const TenantDatabaseTier = {
  Shared: "shared",
  Dedicated: "dedicated",
} as const;

export type TenantDatabaseTierValue =
  (typeof TenantDatabaseTier)[keyof typeof TenantDatabaseTier];

const TENANT_DATABASE_TIER_SET: ReadonlySet<string> = new Set(
  Object.values(TenantDatabaseTier),
);

export function isTenantDatabaseTier(
  value: string,
): value is TenantDatabaseTierValue {
  return TENANT_DATABASE_TIER_SET.has(value);
}

export function tenantPostgresDatabaseName(tenantId: string): string {
  return `tenant_${tenantId}`;
}

export function tenantPostgresRoleName(tenantId: string): string {
  return `${tenantPostgresDatabaseName(tenantId)}_app`;
}
