import "reflect-metadata";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class PaginatedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "limit must be an integer" })
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "offset must be an integer" })
  @Min(0)
  offset?: number;
}
