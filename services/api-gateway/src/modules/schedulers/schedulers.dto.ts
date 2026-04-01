import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
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
