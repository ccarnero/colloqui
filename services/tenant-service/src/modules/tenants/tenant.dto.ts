import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsOptional,
  IsObject,
} from "class-validator";
import type { JsonValue, ProvisioningStatusValue } from "@yoizen/shared";

export {
  VALID_ENVIRONMENTS,
  type Environment,
  type JsonValue,
  type ProvisioningStatusValue,
} from "@yoizen/shared";

export type TenantConfiguration = { [key: string]: JsonValue };

export interface ITenantRow {
  id: string;
  name: string;
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
  @IsObject()
  configuration?: TenantConfiguration;
}

export class UpdateTenantDto {
  @IsObject()
  @IsNotEmpty()
  configuration!: TenantConfiguration;
}
