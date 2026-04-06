import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsOptional,
  IsObject,
} from "class-validator";
import type { JsonValue } from "@yoizen/shared";

export { VALID_ENVIRONMENTS, type Environment } from "@yoizen/shared";

export type { JsonValue };

export type TenantConfiguration = { [key: string]: JsonValue };

export interface ITenantRow {
  id: string;
  name: string;
  configuration: TenantConfiguration;
  created_at: Date;
  updated_at: Date;
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
  @IsObject()
  configuration?: TenantConfiguration;
}

export class UpdateTenantDto {
  @IsObject()
  @IsNotEmpty()
  configuration!: TenantConfiguration;
}
