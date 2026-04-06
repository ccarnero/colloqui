import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsOptional,
  IsObject,
} from "class-validator";

/** Proxy body for POST /tenants — aligned with tenant-service CreateTenantDto. */
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
