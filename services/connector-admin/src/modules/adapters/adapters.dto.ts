import {
  ADAPTER_MAX_RETRIES_MAX,
  ADAPTER_RETRY_BACKOFF_MS_MAX,
  ADAPTER_TIMEOUT_MS_MAX,
  AdapterCacheMethod,
  AdapterCacheQueryParamsMode,
} from "@yoizen/shared";
import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  registerDecorator,
  ValidateNested,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";

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

const CACHE_METHODS = [
  AdapterCacheMethod.GET,
  AdapterCacheMethod.HEAD,
  AdapterCacheMethod.POST,
  AdapterCacheMethod.PUT,
  AdapterCacheMethod.PATCH,
  AdapterCacheMethod.DELETE,
] as const;

function IsStringArrayOrAll(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: "isStringArrayOrAll",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) {
            return true;
          }
          if (value === AdapterCacheQueryParamsMode.ALL) {
            return true;
          }
          return (
            Array.isArray(value) &&
            value.every(
              (entry) => typeof entry === "string" && entry.trim().length > 0
            )
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be "all" or an array of non-empty strings`;
        },
      },
    });
  };
}

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

  @IsOptional()
  @IsString()
  tag?: string;

  /**
   * Filter by exact adapter name. Combined with `context=internal` this
   * is used by `AdapterClient.findInternalByServiceId()` to look up the
   * internal-adapter mirror for a given serviceId.
   */
  @IsOptional()
  @IsString()
  name?: string;
}

export class CacheStrategyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  ttlSeconds!: number;

  @IsArray()
  @ArrayUnique()
  @IsIn([...CACHE_METHODS], { each: true })
  @IsOptional()
  methods?: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  keyHeaders?: string[];

  @IsStringArrayOrAll()
  @IsOptional()
  keyQueryParams?: string[] | typeof AdapterCacheQueryParamsMode.ALL;

  @IsBoolean()
  @IsOptional()
  keyBody?: boolean;
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

  @ValidateNested()
  @Type(() => CacheStrategyDto)
  @IsOptional()
  cache?: CacheStrategyDto;
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
  @Max(ADAPTER_TIMEOUT_MS_MAX)
  @IsOptional()
  timeoutMs?: number;

  @IsInt()
  @Min(0)
  @Max(ADAPTER_MAX_RETRIES_MAX)
  @IsOptional()
  maxRetries?: number;

  @IsInt()
  @Min(0)
  @Max(ADAPTER_RETRY_BACKOFF_MS_MAX)
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

  @ValidateNested()
  @Type(() => CacheStrategyDto)
  @IsOptional()
  defaultCache?: CacheStrategyDto;
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
  @Max(ADAPTER_TIMEOUT_MS_MAX)
  @IsOptional()
  timeoutMs?: number;

  @IsInt()
  @Min(0)
  @Max(ADAPTER_MAX_RETRIES_MAX)
  @IsOptional()
  maxRetries?: number;

  @IsInt()
  @Min(0)
  @Max(ADAPTER_RETRY_BACKOFF_MS_MAX)
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

  @ValidateNested()
  @Type(() => CacheStrategyDto)
  @IsOptional()
  defaultCache?: CacheStrategyDto | null;
}

export class UpdateEndpointDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsIn([...HTTP_METHODS])
  @IsOptional()
  method?: string;

  @IsString()
  @IsOptional()
  path?: string;

  @ValidateNested()
  @Type(() => CacheStrategyDto)
  @IsOptional()
  cache?: CacheStrategyDto | null;
}
