import { Type } from "class-transformer";
import {
  Allow,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class SetCacheDto {
  @Allow()
  value!: unknown;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ttl?: number;
}

export class BatchGetDto {
  @IsArray()
  @IsString({ each: true })
  keys!: string[];
}

/** Query params for `GET /cache` (SCAN). */
export class ListCacheKeysQueryDto {
  @IsOptional()
  @IsString()
  pattern = "*";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  count = 100;
}
