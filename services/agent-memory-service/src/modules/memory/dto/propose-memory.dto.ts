import { Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { MemoryScope, MemoryKind } from "../domain/enums";

export { MemoryScope, MemoryKind } from "../domain/enums";

export class ProposeMemoryDto {
  @IsEnum(MemoryScope)
  scope!: MemoryScope;

  @IsEnum(MemoryKind)
  kind!: MemoryKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  content!: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  topicKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ttl?: number;
}
