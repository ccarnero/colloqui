import { IsDateString, IsOptional, IsString } from "class-validator";
import { PaginatedQueryDto } from "@yoizen/shared";

export class QueryGatewayEventsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  routeType?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
