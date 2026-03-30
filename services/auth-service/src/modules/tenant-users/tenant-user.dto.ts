import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

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

  @IsString()
  @IsNotEmpty()
  role_id!: string;

  @IsOptional()
  @IsString()
  display_name?: string;
}

export class UpdateTenantUserDto {
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
