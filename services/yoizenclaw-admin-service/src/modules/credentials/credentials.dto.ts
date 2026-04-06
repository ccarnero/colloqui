import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsBoolean,
  IsIn,
  IsISO8601,
  Length,
} from "class-validator";
import { Type } from "class-transformer";
import type { CredentialProvider } from "./providers/credential-provider.registry";
import { ALL_PROVIDERS } from "./providers/credential-provider.registry";

export class CreateProviderCredentialDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(ALL_PROVIDERS)
  provider!: CredentialProvider;

  @IsObject()
  @IsNotEmpty()
  payload!: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  @Type(() => Object)
  metadata?: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  expires_at?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class UpdateProviderCredentialDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsString()
  @IsOptional()
  @IsIn(ALL_PROVIDERS)
  provider?: CredentialProvider;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  @Type(() => Object)
  metadata?: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  expires_at?: string | null;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class ListCredentialsQueryDto {
  @IsString()
  @IsOptional()
  @IsIn(ALL_PROVIDERS)
  provider?: CredentialProvider;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(["pending", "synced", "failed", "manual_review_required"])
  sync_status?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
}

export class RotateCredentialDto {
  @IsObject()
  @IsNotEmpty()
  payload!: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  new_expires_at?: string;
}

export class SyncCredentialsDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  failed_only?: boolean;
}

export interface CredentialResponseDto {
  id: string;
  name: string;
  provider: CredentialProvider;
  schema_version: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  is_active: boolean;
  sync_status: "pending" | "synced" | "failed" | "manual_review_required";
  last_sync_at: string | null;
  sync_error: string | null;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderInfoDto {
  provider: CredentialProvider;
  display_name: string;
  description: string;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    secret: boolean;
    description: string;
    placeholder?: string;
    options?: string[];
  }>;
}

export interface SyncStatusResponseDto {
  credential_id: string;
  sync_status: "pending" | "synced" | "failed";
  last_sync_at: string | null;
  sync_error: string | null;
}
