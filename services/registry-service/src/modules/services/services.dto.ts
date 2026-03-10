import {
  IsString,
  IsNotEmpty,
  MaxLength,
  Matches,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
} from 'class-validator';

const VALID_ENVIRONMENTS = ['dev', 'qa', 'staging', 'production'] as const;
export type Environment = (typeof VALID_ENVIRONMENTS)[number];
export { VALID_ENVIRONMENTS };

export class RegisterServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      'name must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen',
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
