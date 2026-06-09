import { Type } from "class-transformer";
import {
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  Max,
  Min,
} from "class-validator";
import {
  MemoryScope,
  MemoryKind,
  MemoryStatus,
} from "../domain/enums";

export { MemoryScope as MemoryQueryScope } from "../domain/enums";
export { MemoryKind as MemoryQueryKind } from "../domain/enums";
export { MemoryStatus as MemoryQueryStatus } from "../domain/enums";

export class MemoryQueryDto {
  @IsEnum(MemoryScope)
  @IsOptional()
  scope?: MemoryScope;

  @IsEnum(MemoryKind)
  @IsOptional()
  kind?: MemoryKind;

  @IsEnum(MemoryStatus)
  @IsOptional()
  status?: MemoryStatus;

  @IsBoolean()
  @IsOptional()
  includeExpired?: boolean;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  context?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
