import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

/** Declared headers for outbound adapter HTTP calls (whitelist-safe nested shape). */
export class HeaderEntryDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class CreateEndpointDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  method!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;
}

export class CreateAdapterDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsIn(["internal", "external"])
  context!: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  @IsOptional()
  authType?: string;

  @IsObject()
  @IsOptional()
  authConfig?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeaderEntryDto)
  @IsOptional()
  headers?: HeaderEntryDto[];

  @IsInt()
  @Min(100)
  @IsOptional()
  timeoutMs?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxRetries?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  retryBackoffMs?: number;

  @IsString()
  @IsOptional()
  healthCheckPath?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEndpointDto)
  @IsOptional()
  endpoints?: CreateEndpointDto[];
}

export class UpdateAdapterDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsString()
  @IsOptional()
  authType?: string;

  @IsObject()
  @IsOptional()
  authConfig?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HeaderEntryDto)
  @IsOptional()
  headers?: HeaderEntryDto[];

  @IsInt()
  @Min(100)
  @IsOptional()
  timeoutMs?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxRetries?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  retryBackoffMs?: number;

  @IsString()
  @IsOptional()
  healthCheckPath?: string;

  @IsString()
  @IsIn(["enabled", "disabled"])
  @IsOptional()
  status?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
