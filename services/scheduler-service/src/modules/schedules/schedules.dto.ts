import { Type } from "class-transformer";
import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
  ValidateNested,
  IsInt,
  Min,
  IsObject,
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

export class ScheduleResourceDto {
  @IsOptional()
  @IsString()
  cpu?: string;

  @IsOptional()
  @IsString()
  memory?: string;
}

/** Declarative shape for schedule `config` JSON (runtime rules remain in validateConfig). */
export class ScheduleConfigDto {
  @IsOptional()
  @IsString()
  script?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsObject()
  env?: Record<string, string>;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeout?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleResourceDto)
  resources?: ScheduleResourceDto;
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

  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  config!: ScheduleConfigDto;

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
  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  config?: ScheduleConfigDto;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
