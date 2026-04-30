import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import {
  AdapterCacheMethod,
  AdapterCacheQueryParamsMode,
} from "@yoizen/shared";

const CACHE_METHODS = [
  AdapterCacheMethod.GET,
  AdapterCacheMethod.HEAD,
  AdapterCacheMethod.POST,
  AdapterCacheMethod.PUT,
  AdapterCacheMethod.PATCH,
  AdapterCacheMethod.DELETE,
] as const;

function IsStringArrayOrAll(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
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
              (entry) => typeof entry === "string" && entry.trim().length > 0,
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

/** Declared headers for outbound adapter HTTP calls (whitelist-safe nested shape). */
export class HeaderEntryDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  value!: string;
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

  @IsString()
  @IsNotEmpty()
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

  @ValidateNested()
  @Type(() => CacheStrategyDto)
  @IsOptional()
  defaultCache?: CacheStrategyDto;
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

  @ValidateNested()
  @Type(() => CacheStrategyDto)
  @IsOptional()
  defaultCache?: CacheStrategyDto | null;
}

export class UpdateEndpointDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
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
