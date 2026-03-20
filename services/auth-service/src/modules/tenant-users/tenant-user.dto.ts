import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export enum TenantUserRole {
  TENANT_ADMIN = "tenant_admin",
  TENANT_EDITOR = "tenant_editor",
  TENANT_VIEWER = "tenant_viewer",
}

export class CreateTenantUserDto {
  @IsString()
  @IsNotEmpty()
  tenant_id!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;

  @IsEnum(TenantUserRole)
  role!: TenantUserRole;

  @IsOptional()
  @IsString()
  display_name?: string;
}

export class UpdateTenantUserDto {
  @IsOptional()
  @IsEnum(TenantUserRole)
  role?: TenantUserRole;

  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  is_active?: boolean;
}
