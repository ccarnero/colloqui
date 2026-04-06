import { Transform } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

function toOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return Number(value);
}

/**
 * Shared limit/offset query DTO for list endpoints (audit, scheduler, etc.).
 */
export class PaginatedQueryDto {
  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt()
  @Min(0)
  offset?: number;
}
