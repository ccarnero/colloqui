import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsBoolean,
  IsUUID,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class ListJobsQueryDto {
  @IsUUID()
  @IsOptional()
  agent_id?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
}

export class ListJobExecutionsQueryDto {
  @IsUUID()
  @IsOptional()
  job_id?: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
}
