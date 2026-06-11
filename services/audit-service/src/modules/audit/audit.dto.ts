import { IsDateString, IsOptional, IsString } from "class-validator";
import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";

export class QueryEventsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
