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
import { PaginatedQueryDto } from "@yoizen/shared";

// FIXME: Encrypt with KMS/Vault — currently stored as plaintext
export type CredentialType = "api_key" | "oauth" | "basic" | "custom";

export class CreateCredentialDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(["api_key", "oauth", "basic", "custom"])
  type!: CredentialType;

  @IsString()
  @IsNotEmpty()
  // FIXME: Encrypt with KMS/Vault before production
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
  @IsIn(["api_key", "oauth", "basic", "custom"])
  type?: CredentialType;

  @IsString()
  @IsOptional()
  // FIXME: Encrypt with KMS/Vault before production
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

export class ListCredentialsQueryDto extends PaginatedQueryDto {
  @IsString()
  @IsOptional()
  @IsIn(["api_key", "oauth", "basic", "custom"])
  type?: CredentialType;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class RotateCredentialDto {
  @IsString()
  @IsNotEmpty()
  // FIXME: Encrypt with KMS/Vault before production
  new_value!: string;

  @IsISO8601()
  @IsOptional()
  new_expires_at?: string;
}
