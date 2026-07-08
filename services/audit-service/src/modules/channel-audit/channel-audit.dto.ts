import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";
import { IsDateString, IsOptional, IsString } from "class-validator";

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
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
