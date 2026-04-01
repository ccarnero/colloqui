import { Type } from 'class-transformer';
import { Allow, IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
