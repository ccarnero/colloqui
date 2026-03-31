import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsArray,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_CONTENT_LENGTH = 1_000_000;

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  system_prompt!: string;

  @IsObject()
  @IsOptional()
  model_config?: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  tools?: unknown[];

  @IsArray()
  @IsOptional()
  channels?: unknown[];
}

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  system_prompt?: string;

  @IsObject()
  @IsOptional()
  model_config?: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  tools?: unknown[];

  @IsArray()
  @IsOptional()
  channels?: unknown[];

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class CreateCredentialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsObject()
  @IsNotEmpty()
  config!: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateCredentialDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class RotateCredentialDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  reason?: string;
}

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty()
  agent_id!: string;

  @IsObject()
  @IsOptional()
  schedule?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateJobDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @IsObject()
  @IsOptional()
  schedule?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class TriggerJobDto {
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;
}

export class ConfigFileDto {
  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTENT_LENGTH)
  content!: string;
}

export class UpsertConfigFileDto {
  @IsArray()
  @IsNotEmpty()
  files!: ConfigFileDto[];
}

export class DeployConfigFilesDto {
  @IsArray()
  @IsOptional()
  file_paths?: string[];

  @IsBoolean()
  @IsOptional()
  restart?: boolean;
}