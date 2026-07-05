import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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
  @ApiProperty({ enum: AuthGrantTypeDto })
  @IsEnum(AuthGrantTypeDto)
  grant_type!: AuthGrantTypeDto;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  client_secret!: string;
}

/** POST /auth/login -- user credentials (matches auth-service LoginDto). */
export class AuthLoginBodyDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenant_id?: string;
}

/** POST /auth/refresh (matches auth-service RefreshDto). */
export class AuthRefreshBodyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

/** POST /auth/users -- minimal shape; downstream enforces role and rules. */
export class CreateUserBodyDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string;
}

/** POST /auth/clients -- at least name; optional scope for gateway tenant checks. */
export class CreateClientBodyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  scope?: string;
}

/** POST /auth/public-routes -- matches auth-service CreatePublicRouteDto. */
export class CreatePublicRouteDto {
  @ApiProperty({ enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "*"] })
  @IsString()
  @IsIn(["GET", "POST", "PUT", "PATCH", "DELETE", "*"])
  method!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  path_pattern!: string;

  @ApiProperty({ description: '"platform" or "tenant:<name>"' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(platform|tenant:[a-z0-9]([a-z0-9-]*[a-z0-9])?)$/, {
    message: 'scope must be "platform" or "tenant:<name>"',
  })
  scope!: string;
}

/** POST /auth/tenant-users -- matches auth-service CreateTenantUserDto. */
export class CreateTenantUserBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  role_id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;
}

/** PATCH /auth/tenant-users/:id -- matches auth-service UpdateTenantUserDto. */
export class UpdateTenantUserBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class PermissionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resource!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  action!: string;
}

/** POST /auth/tenant-roles -- matches auth-service CreateTenantRoleDto. */
export class CreateTenantRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [PermissionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions!: PermissionDto[];
}

/** PATCH /auth/tenant-roles/:id -- matches auth-service UpdateTenantRoleDto. */
export class UpdateTenantRoleDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [PermissionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions?: PermissionDto[];
}
