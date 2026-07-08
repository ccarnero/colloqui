import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";
import { IsDateString, IsOptional, IsString } from "class-validator";

export class QueryExecutionEventsDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  executionId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
