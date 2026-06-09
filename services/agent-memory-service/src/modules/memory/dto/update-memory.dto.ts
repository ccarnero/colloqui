import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateMemoryDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50_000)
  content?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
