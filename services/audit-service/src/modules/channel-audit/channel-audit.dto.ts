import { IsDateString, IsOptional, IsString } from "class-validator";
import { PaginatedQueryDto } from "@yoizen/shared";

export class QueryChannelEventsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
