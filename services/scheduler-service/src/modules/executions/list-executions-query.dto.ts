import { IsOptional, IsString } from "class-validator";
import { PaginatedQueryDto } from "@yoizen/shared";

/** Query for `GET /executions` and `GET /schedules/:id/executions`. */
export class ListExecutionsQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
