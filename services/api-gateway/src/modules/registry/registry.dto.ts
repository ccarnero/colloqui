import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const VALID_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export class RegisterServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      "name must be lowercase alphanumeric with optional hyphens, " +
      "cannot start or end with a hyphen",
  })
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  image!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  concurrencyTarget?: number;

  @IsOptional()
  @IsObject()
  envVars?: Record<string, string>;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  image?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxScale?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  concurrencyTarget?: number;

  @IsOptional()
  @IsObject()
  envVars?: Record<string, string>;
}

export class StartCanaryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  image!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  percent!: number;
}

export class UpdateCanaryDto {
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;
}

export class CreateRouteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^\//, { message: "pathPrefix must start with /" })
  pathPrefix!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsIn([...VALID_METHODS], { each: true })
  methods?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  stripPrefix?: boolean;
}
