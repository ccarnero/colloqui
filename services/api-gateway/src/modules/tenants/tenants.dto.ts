import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsOptional,
  IsObject,
  IsIn,
} from "class-validator";
import {
  TenantDatabaseTier,
  type TenantDatabaseTierValue,
} from "@yoizen/shared";

/**
 * Proxy body for POST /tenants — aligned with tenant-service CreateTenantDto.
 *
 * Must mirror EVERY field accepted by `tenant-service` because the
 * gateway's global `ValidationPipe` runs with `forbidNonWhitelisted:
 * true` (see `main.ts`). Any field omitted here is rejected at the
 * gateway with HTTP 400 before being proxied downstream.
 */
export class CreateTenantBodyDto {
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
  @IsObject()
  configuration?: Record<string, unknown>;
}

/**
 * Proxy body for PATCH /tenants/:name — aligned with tenant-service UpdateTenantDto.
 */
export class UpdateTenantBodyDto {
  @IsObject()
  @IsNotEmpty()
  configuration!: Record<string, unknown>;
}
