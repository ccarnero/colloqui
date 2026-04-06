import { IsDateString, IsOptional, IsString } from "class-validator";
import { PaginatedQueryDto } from "@yoizen/shared";

export class QueryMetricsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
