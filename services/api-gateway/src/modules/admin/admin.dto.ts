import {
  IsEnum,
  IsIn,
  IsInt,
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsArray,
  IsNotEmpty,
  MaxLength,
  ValidateNested,
  ValidationOptions,
  ValidationArguments,
  registerDecorator,
  MinLength,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { PaginatedQueryDto } from "@yoizen/shared";

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SYSTEM_PROMPT_LENGTH = 50_000;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_MEMORY_CONTENT_LENGTH = 1_000_000;

export enum MemoryScope {
  SESSION = "SESSION",
  USER = "USER",
  TENANT = "TENANT",
}

export enum MemoryKind {
  PREFERENCE = "PREFERENCE",
  FACT = "FACT",
  NOTICE = "NOTICE",
  INCIDENT = "INCIDENT",
  PROMO = "PROMO",
}

export enum MemoryStatus {
  PROPOSED = "PROPOSED",
  ACTIVE = "ACTIVE",
  PUBLISHED = "PUBLISHED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
  ARCHIVED = "ARCHIVED",
}

function AtLeastOneField(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "atLeastOneField",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          return Object.keys(obj).some((key) => obj[key] !== undefined);
        },
        defaultMessage() {
          return "At least one field must be provided for update";
        },
      },
    });
  };
}

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
  @MaxLength(MAX_SYSTEM_PROMPT_LENGTH)
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

  @IsArray() @IsOptional() @IsString({ each: true })
  knowledge_base_ids?: string[];
  @IsArray() @IsOptional()
  input_variables?: unknown[];
  @IsArray() @IsOptional()
  output_variables?: unknown[];
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
  @MaxLength(MAX_SYSTEM_PROMPT_LENGTH)
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

export class UpdateEnabledToolsDto {
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_tools?: string[] | null;
}

export class UpdateEnabledMcpServersDto {
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_mcp_servers?: string[] | null;
}

/**
 * Per-agent tool description overrides.
 * Feature flag: `agent.tool_description_overrides_enabled` (default off).
 * Each value ≤ 2000 chars; `\n` allowed; trimmed on save.
 * Unknown tool names stored but ignored at runtime.
 *
 * Note: Per-value length cap is enforced by the frontend textarea.
 * No server-side length validation — the bridge doesn't reject long values.
 * Keys that don't match a declared tool are stored but ignored at runtime.
 */
export class UpdateToolDescriptionOverridesDto {
  @IsObject()
  @IsOptional()
  tool_description_overrides?: Record<string, string> | null;
}

export class CreateMcpServerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn(["http", "sse"])
  transport_type!: "http" | "sse";

  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsObject()
  @IsOptional()
  headers?: Record<string, string>;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class UpdateMcpServerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsString()
  @IsOptional()
  @IsIn(["http", "sse"])
  transport_type?: "http" | "sse";

  @IsString()
  @IsOptional()
  url?: string;

  @IsObject()
  @IsOptional()
  headers?: Record<string, string> | null;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class McpServerIdParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class ChatContextEntryDto {
  @IsString()
  @IsIn(["customer", "agent"])
  sender!: "customer" | "agent";

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

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @IsString()
  @IsNotEmpty()
  agent_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  schedule!: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateJobDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @IsString()
  @IsOptional()
  agent_id?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  schedule?: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

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
  is_active?: boolean;

  @IsArray() @IsOptional() @IsString({ each: true })
  knowledge_base_ids?: string[];
  @IsArray() @IsOptional()
  input_variables?: unknown[];
  @IsArray() @IsOptional()
  output_variables?: unknown[];
}

/** Query for `GET /admin/agents`. */
export class AdminAgentsListQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  is_active?: string;
}

/** Query for `GET /admin/jobs`. */
export class AdminJobsListQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  agent_id?: string;

  @IsOptional()
  @IsString()
  is_active?: string;
}

/** Query for `GET /admin/jobs/executions`. */
export class AdminJobExecutionsListQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsString()
  job_id?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

/** Query for `GET /admin/config-files`. */
export class AdminConfigFilesListQueryDto extends PaginatedQueryDto {}

/** Query for `GET /admin/config-files/file`. */
export class ConfigFilePathQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  path!: string;
}

export class MemoryIdParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class AdminMemoryListQueryDto {
  @IsEnum(MemoryScope)
  @IsOptional()
  scope?: MemoryScope;

  @IsEnum(MemoryKind)
  @IsOptional()
  kind?: MemoryKind;

  @IsEnum(MemoryStatus)
  @IsOptional()
  status?: MemoryStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  offset?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  includeExpired?: boolean;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  context?: string;
}

export class CreateMemoryDto {
  @IsString()
  @IsNotEmpty()
  scope!: string;

  @IsString()
  @IsNotEmpty()
  kind!: string;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  title?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MEMORY_CONTENT_LENGTH)
  content!: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  topicKey?: string;

  @IsInt()
  @IsOptional()
  ttl?: number;
}

export class UpdateMemoryDto {
  @AtLeastOneField({
    message:
      "At least one field (title, content, metadata, topicKey) must be provided",
  })
  _atLeastOne?: never;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(MAX_MEMORY_CONTENT_LENGTH)
  content?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  topicKey?: string;
}
