import { IsOptional, IsString } from "class-validator";
import { PaginatedQueryDto } from "@yoizen/shared";

/** Query for `GET /schedules`. */
export class ListSchedulesQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  enabled?: string;

  @IsOptional()
  @IsString()
  type?: string;
}
