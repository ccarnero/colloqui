import {
  type JsonValue,
  type ProvisioningStatusValue,
  TENANT_TIERS,
  TenantDatabaseTier,
  type TenantDatabaseTierValue,
  type TenantTier,
} from "@yoizen/shared";
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export {
  type Environment,
  type JsonValue,
  type ProvisioningStatusValue,
  type TenantDatabaseTierValue,
  VALID_ENVIRONMENTS,
} from "@yoizen/shared";

export type TenantConfiguration = { [key: string]: JsonValue };

export interface ITenantRow {
  id: string;
  name: string;
  tier: TenantDatabaseTierValue;
  /** Messaging tier (INGRESS stream limits); absent in storage reads as `free`. */
  messaging_tier: TenantTier;
  configuration: TenantConfiguration;
  created_at: Date;
  updated_at: Date;
  provisioning_status: ProvisioningStatusValue;
  provisioning_error: string | null;
  provisioning_started_at: Date | null;
  provisioning_completed_at: Date | null;
}

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      "name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen",
  })
  name!: string;

  @IsOptional()
  @IsIn(Object.values(TenantDatabaseTier))
  tier?: TenantDatabaseTierValue;

  @IsOptional()
  @IsIn(TENANT_TIERS)
  messagingTier?: TenantTier;

  @IsOptional()
  @IsObject()
  configuration?: TenantConfiguration;
}

/**
 * Both fields optional so a caller can change either independently; the
 * service rejects a body carrying neither (400). `configuration` was the
 * only (required) member until 2026-08-01 — existing callers that always
 * send it are unaffected.
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsObject()
  @IsNotEmpty()
  configuration?: TenantConfiguration;

  @IsOptional()
  @IsIn(TENANT_TIERS)
  messagingTier?: TenantTier;
}
