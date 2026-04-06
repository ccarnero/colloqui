import {
  IsIn,
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsArray,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
  IsISO8601,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class ChatContextEntryDto {
  @IsString()
  @IsIn(['customer', 'agent'])
  sender!: 'customer' | 'agent';

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  channel?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChatContextEntryDto)
  context?: ChatContextEntryDto[];
}

export class MemoryProposalParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class MemoryDecisionDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  reason?: string;
}

/**
 * Provider-aware credential creation
 */
export class CreateCredentialDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, MAX_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([
    'openai',
    'anthropic',
    'google',
    'google-vertex',
    'bedrock',
    'groq',
    'mistral',
    'openrouter',
    'xai',
    'cohere',
    'cerebras',
    'huggingface',
    'mock',
  ])
  provider!: string;

  @IsObject()
  @IsNotEmpty()
  payload!: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  expires_at?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

/**
 * Provider-aware credential update
 * Omitting secret fields in payload preserves existing values
 */
export class UpdateCredentialDto {
  @IsString()
  @IsOptional()
  @Length(1, MAX_NAME_LENGTH)
  name?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'openai',
    'anthropic',
    'google',
    'google-vertex',
    'bedrock',
    'groq',
    'mistral',
    'openrouter',
    'xai',
    'cohere',
    'cerebras',
    'huggingface',
    'mock',
  ])
  provider?: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  expires_at?: string | null;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

/**
 * Credential rotation (replace secret values)
 */
export class RotateCredentialDto {
  @IsObject()
  @IsNotEmpty()
  payload!: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  new_expires_at?: string;
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
