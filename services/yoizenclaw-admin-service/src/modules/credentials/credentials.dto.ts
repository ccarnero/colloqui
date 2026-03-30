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

// FIXME: Implementar cifrado con KMS/Vault - actualmente almacenado en plaintext
export type CredentialType = 'api_key' | 'oauth' | 'basic' | 'custom';

export class CreateCredentialDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['api_key', 'oauth', 'basic', 'custom'])
  type!: CredentialType;

  @IsString()
  @IsNotEmpty()
  // FIXME: Implementar cifrado con KMS/Vault antes de producción
  value!: string;

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

export class UpdateCredentialDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsString()
  @IsOptional()
  @IsIn(['api_key', 'oauth', 'basic', 'custom'])
  type?: CredentialType;

  @IsString()
  @IsOptional()
  // FIXME: Implementar cifrado con KMS/Vault antes de producción
  value?: string;

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

export class ListCredentialsQueryDto {
  @IsString()
  @IsOptional()
  @IsIn(['api_key', 'oauth', 'basic', 'custom'])
  type?: CredentialType;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
}

export class RotateCredentialDto {
  @IsString()
  @IsNotEmpty()
  // FIXME: Implementar cifrado con KMS/Vault antes de producción
  new_value!: string;

  @IsISO8601()
  @IsOptional()
  new_expires_at?: string;
}
