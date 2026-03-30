import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class PermissionDto {
  @IsString()
  @IsNotEmpty()
  resource!: string;

  @IsString()
  @IsNotEmpty()
  action!: string;
}

export class CreateTenantRoleDto {
  @IsString()
  @IsNotEmpty()
  tenant_id!: string;

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
