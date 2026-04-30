import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

export enum AuthGrantTypeDto {
  CLIENT_CREDENTIALS = "client_credentials",
}

/** POST /auth/token -- client credentials (matches auth-service token.dto). */
export class AuthTokenBodyDto {
  @IsEnum(AuthGrantTypeDto)
  grant_type!: AuthGrantTypeDto;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;
}

/** POST /auth/login -- user credentials (matches auth-service LoginDto). */
export class AuthLoginBodyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  tenant_id?: string;
}

/** POST /auth/refresh (matches auth-service RefreshDto). */
export class AuthRefreshBodyDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

/** POST /auth/users -- minimal shape; downstream enforces role and rules. */
export class CreateUserBodyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

/** POST /auth/clients -- at least name; optional scope for gateway tenant checks. */
export class CreateClientBodyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scope?: string;
}

/** POST /auth/public-routes -- matches auth-service CreatePublicRouteDto. */
export class CreatePublicRouteDto {
  @IsString()
  @IsIn(["GET", "POST", "PUT", "PATCH", "DELETE", "*"])
  method!: string;

  @IsString()
  @IsNotEmpty()
  path_pattern!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(platform|tenant:[a-z0-9]([a-z0-9-]*[a-z0-9])?)$/, {
    message: 'scope must be "platform" or "tenant:<name>"',
  })
  scope!: string;
}

/** POST /auth/tenant-users -- matches auth-service CreateTenantUserDto. */
export class CreateTenantUserBodyDto {
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  role_id!: string;

  @IsOptional()
  @IsString()
  display_name?: string;
}

/** PATCH /auth/tenant-users/:id -- matches auth-service UpdateTenantUserDto. */
export class UpdateTenantUserBodyDto {
  @IsOptional()
  @IsString()
  role_id?: string;

  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class PermissionDto {
  @IsString()
  @IsNotEmpty()
  resource!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;
}

/** POST /auth/tenant-roles -- matches auth-service CreateTenantRoleDto. */
export class CreateTenantRoleDto {
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions!: PermissionDto[];
}

/** PATCH /auth/tenant-roles/:id -- matches auth-service UpdateTenantRoleDto. */
export class UpdateTenantRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions?: PermissionDto[];
}
