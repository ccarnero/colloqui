import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsBoolean,
  IsIn,
  IsISO8601,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { CredentialProvider } from './providers/credential-provider.registry';
import { ALL_PROVIDERS } from './providers/credential-provider.registry';

/**
 * DTO for creating a provider-aware credential
 */
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
  /**
   * Provider-specific payload containing fields like:
   * - api_key, base_url for openai/anthropic/etc
   * - project_id, region, service_account_json for google-vertex
   * - aws_access_key_id, aws_secret_access_key, aws_session_token, region for bedrock
   */
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

/**
 * DTO for updating a provider-aware credential
 * Note: omitting a secret field in payload preserves the existing secret
 */
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
  /**
   * Provider-specific payload. Omit secret fields to preserve existing values.
   * Set a secret field to empty string or new value to replace it.
   */
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

/**
 * DTO for listing/querying credentials
 */
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
  @IsIn(['pending', 'synced', 'failed', 'manual_review_required'])
  sync_status?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
}

/**
 * DTO for rotating a credential (replacing secret values)
 */
export class RotateCredentialDto {
  @IsObject()
  @IsNotEmpty()
  /**
   * New provider payload with replacement secret values.
   * Only secret fields that need rotation should be included.
   */
  payload!: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  new_expires_at?: string;
}

/**
 * DTO for manual sync trigger
 */
export class SyncCredentialsDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  /**
   * If true, only sync credentials with failed status
   */
  failed_only?: boolean;
}

// ============================================================================
// Response DTOs
// ============================================================================

/**
 * Masked credential response - never includes plaintext secrets
 */
export interface CredentialResponseDto {
  id: string;
  name: string;
  provider: CredentialProvider;
  schema_version: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  is_active: boolean;
  sync_status: 'pending' | 'synced' | 'failed' | 'manual_review_required';
  last_sync_at: string | null;
  sync_error: string | null;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Provider info response
 */
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

/**
 * Sync status response
 */
export interface SyncStatusResponseDto {
  credential_id: string;
  sync_status: 'pending' | 'synced' | 'failed';
  last_sync_at: string | null;
  sync_error: string | null;
}
