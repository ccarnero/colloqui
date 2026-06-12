import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsBoolean,
  IsUUID,
  IsIn,
  Length,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";
import { IsSchedule } from "./schedule.validator";

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsUUID()
  @IsNotEmpty()
  agent_id!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  @IsSchedule()
  schedule!: string;

  @IsObject()
  @IsOptional()
  @Type(() => Object)
  payload?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class UpdateJobDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsUUID()
  @IsOptional()
  agent_id?: string;

  @IsString()
  @IsOptional()
  @Length(1, 255)
  @IsSchedule()
  schedule?: string;

  @IsObject()
  @IsOptional()
  @Type(() => Object)
  payload?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class TriggerJobDto {
  @IsObject()
  @IsOptional()
  @Type(() => Object)
  event_payload?: Record<string, unknown>;
}

export class ListJobsQueryDto extends PaginatedQueryDto {
  @IsUUID()
  @IsOptional()
  agent_id?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class ListJobExecutionsQueryDto extends PaginatedQueryDto {
  @IsUUID()
  @IsOptional()
  job_id?: string;

  @IsOptional()
  @IsIn(["pending", "running", "completed", "failed"])
  status?: string;
}
