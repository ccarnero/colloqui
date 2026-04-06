import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export enum ScheduleType {
  CRON = "cron",
  INTERVAL = "interval",
  ONE_TIME = "one-time",
}

export enum ExecMode {
  JS_INLINE = "js-inline",
  JS_K8S = "js-k8s",
  DOCKER = "docker",
}

function toOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return Number(value);
}

export class CreateScheduleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsEnum(ScheduleType)
  type!: ScheduleType;

  @IsString()
  @MinLength(1)
  expression!: string;

  @IsEnum(ExecMode)
  exec_mode!: ExecMode;

  @IsObject()
  config!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsEnum(ScheduleType)
  type?: ScheduleType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  expression?: string;

  @IsOptional()
  @IsEnum(ExecMode)
  exec_mode?: ExecMode;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** Query for `GET /schedulers/schedules` (mirrors scheduler-service list). */
export class ListSchedulesQueryProxyDto {
  @IsOptional()
  @IsString()
  enabled?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Query for execution list endpoints. */
export class ListExecutionsQueryProxyDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt()
  @Min(0)
  offset?: number;
}
