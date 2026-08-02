import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
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

/**
 * Proxy body for POST /tenants — aligned with tenant-service CreateTenantDto.
 *
 * Must mirror EVERY field accepted by `tenant-service` because the
 * gateway's global `ValidationPipe` runs with `forbidNonWhitelisted:
 * true` (see `main.ts`). Any field omitted here is rejected at the
 * gateway with HTTP 400 before being proxied downstream.
 */
export class CreateTenantBodyDto {
  @ApiProperty({
    description:
      "Lowercase alphanumeric tenant slug, optional hyphens, cannot start/end with a hyphen.",
    maxLength: 32,
    example: "acme-corp",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      "name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen",
  })
  name!: string;

  @ApiPropertyOptional({
    enum: TenantDatabaseTier,
    description: "Database tier for the tenant's provisioned database.",
  })
  @IsOptional()
  @IsIn(Object.values(TenantDatabaseTier))
  tier?: TenantDatabaseTierValue;

  @ApiPropertyOptional({
    enum: TENANT_TIERS,
    description:
      "Messaging tier governing the tenant's INGRESS stream limits. Defaults to `free`.",
  })
  @IsOptional()
  @IsIn(TENANT_TIERS)
  messagingTier?: TenantTier;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Free-form tenant configuration overrides.",
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

/**
 * Proxy body for PATCH /tenants/:name — aligned with tenant-service
 * UpdateTenantDto: both fields optional so either can change independently
 * (tenant-service rejects a body carrying neither with 400).
 */
export class UpdateTenantBodyDto {
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description: "Tenant configuration to merge/replace.",
  })
  @IsOptional()
  @IsObject()
  @IsNotEmpty()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: TENANT_TIERS,
    description: "New messaging tier for the tenant.",
  })
  @IsOptional()
  @IsIn(TENANT_TIERS)
  messagingTier?: TenantTier;
}
