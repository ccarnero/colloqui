import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';

export enum ScheduleType {
  CRON = 'cron',
  INTERVAL = 'interval',
  ONE_TIME = 'one-time',
}

export enum ExecMode {
  JS_INLINE = 'js-inline',
  JS_K8S = 'js-k8s',
  DOCKER = 'docker',
}

export interface ScheduleConfig {
  script?: string;
  image?: string;
  env?: Record<string, string>;
  timeout?: number;
  resources?: { cpu?: string; memory?: string };
  [key: string]: unknown;
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
  config!: ScheduleConfig;

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
  config?: ScheduleConfig;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
