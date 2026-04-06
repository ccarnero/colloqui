import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
  IsObject,
  IsUrl,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginatedQueryDto } from "@yoizen/shared";

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

const ADAPTER_AUTH_TYPES = [
  "none",
  "api-key",
  "bearer",
  "basic",
  "oauth2-client",
] as const;

export class HeaderEntryDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  value!: string;
}

/** Query params for `GET /adapters` list. */
export class ListAdaptersQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsIn(["internal", "external"])
  context?: string;
}

export class CreateEndpointDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsIn([...HTTP_METHODS])
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

  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  baseUrl!: string;

  @IsOptional()
  @IsIn([...ADAPTER_AUTH_TYPES])
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
  @ValidateNested({ each: true })
  @Type(() => CreateEndpointDto)
  @IsOptional()
  endpoints?: CreateEndpointDto[];
}

export class UpdateAdapterDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  @IsOptional()
  @IsIn([...ADAPTER_AUTH_TYPES])
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
}
