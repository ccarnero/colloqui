import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsOptional,
  IsObject,
} from 'class-validator';

export const VALID_ENVIRONMENTS = [
  'dev',
  'qa',
  'staging',
  'production',
] as const;

export type Environment = (typeof VALID_ENVIRONMENTS)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TenantConfiguration = { [key: string]: JsonValue };

export interface TenantRow {
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
      'name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen',
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
