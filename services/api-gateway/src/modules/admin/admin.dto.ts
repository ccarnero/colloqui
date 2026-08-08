import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidateNested,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";

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
  return (object: object, propertyName: string) => {
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
  @ApiProperty({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiProperty({ maxLength: MAX_SYSTEM_PROMPT_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SYSTEM_PROMPT_LENGTH)
  system_prompt!: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  model_config?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  tools?: unknown[];

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  channels?: unknown[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  knowledge_base_ids?: string[];
  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  input_variables?: unknown[];
  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  output_variables?: unknown[];
}

export class UpdateAgentDto {
  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({ maxLength: MAX_SYSTEM_PROMPT_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_SYSTEM_PROMPT_LENGTH)
  system_prompt?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  model_config?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  tools?: unknown[];

  @ApiPropertyOptional({ type: [Object] })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  channels?: unknown[];

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateEnabledToolsDto {
  @ApiPropertyOptional({ type: [String], nullable: true })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_tools?: string[] | null;
}

export class UpdateEnabledMcpServersDto {
  @ApiPropertyOptional({ type: [String], nullable: true })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_mcp_servers?: string[] | null;
}

/**
 * Per-tool MCP allowlist for an agent, keyed by MCP server name
 * (mcp-connections.md §4). A `null` value for a server means "all tools from
 * that server enabled" (backward-compatible default); an array is an explicit
 * allowlist of tool names within that server.
 */
export class UpdateEnabledMcpToolsDto {
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "array", items: { type: "string" } },
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  enabled_mcp_tools?: Record<string, string[] | null> | null;
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
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "string" },
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  tool_description_overrides?: Record<string, string> | null;
}

export class CreateMcpServerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ["http", "sse"] })
  @IsString()
  @IsIn(["http", "sse"])
  transport_type!: "http" | "sse";

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  url!: string;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "string" },
  })
  @IsObject()
  @IsOptional()
  headers?: Record<string, string>;

  @ApiPropertyOptional({ enum: ["none", "api-key", "bearer", "basic"] })
  @IsString()
  @IsOptional()
  @IsIn(["none", "api-key", "bearer", "basic"])
  authType?: "none" | "api-key" | "bearer" | "basic";

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  authConfig?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ["external", "internal"] })
  @IsString()
  @IsOptional()
  @IsIn(["external", "internal"])
  scope?: "external" | "internal";
}

export class UpdateMcpServerDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({ enum: ["http", "sse"] })
  @IsString()
  @IsOptional()
  @IsIn(["http", "sse"])
  transport_type?: "http" | "sse";

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "string" },
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  headers?: Record<string, string> | null;

  @ApiPropertyOptional({ enum: ["none", "api-key", "bearer", "basic"] })
  @IsString()
  @IsOptional()
  @IsIn(["none", "api-key", "bearer", "basic"])
  authType?: "none" | "api-key" | "bearer" | "basic";

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  authConfig?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ["external", "internal"] })
  @IsString()
  @IsOptional()
  @IsIn(["external", "internal"])
  scope?: "external" | "internal";
}

export class McpServerIdParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class ChatContextEntryDto {
  @ApiProperty({ enum: ["customer", "agent"] })
  @IsString()
  @IsIn(["customer", "agent"])
  sender!: "customer" | "agent";

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class ChatRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  conversationId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  channel?: string;

  @ApiPropertyOptional({ type: [ChatContextEntryDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ChatContextEntryDto)
  context?: ChatContextEntryDto[];
}

export class MemoryProposalParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class MemoryDecisionDto {
  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  reason?: string;
}

export class CreateJobDto {
  @ApiProperty({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  agent_id!: string;

  @ApiProperty({ maxLength: 255, description: "Cron expression." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  schedule!: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateJobDto {
  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  agent_id?: string;

  @ApiPropertyOptional({ maxLength: 255, description: "Cron expression." })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  schedule?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class TriggerJobDto {
  /**
   * Kept as `payload` on the gateway's external API for stability, but
   * forwarded to agent-admin-service as `event_payload` — the field name
   * the downstream trigger endpoint actually reads. See
   * `AdminJobsController.triggerJob` for the mapping.
   */
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    description:
      "Forwarded downstream as `event_payload` (agent-admin-service's field name for this endpoint).",
  })
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;
}

/**
 * Mirrors agent-admin-service's `CreateConfigFileDto`. The downstream
 * `PUT /admin/config-files` endpoint accepts a single config file object
 * (create-or-update semantics keyed by `path`), NOT an array wrapper.
 */
export class UpsertConfigFileDto {
  @ApiProperty({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  path!: string;

  @ApiProperty({ maxLength: MAX_CONTENT_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CONTENT_LENGTH)
  content!: string;

  @ApiProperty({ enum: ["yaml", "json"] })
  @IsIn(["yaml", "json"])
  @IsNotEmpty()
  format!: "yaml" | "json";
}

/** Mirrors agent-admin-service's `DeployConfigFilesDto`. */
export class DeployConfigFilesDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      "Paths to remove from the runtime config set as part of this deploy.",
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  deletePaths?: string[];
}

/** Query for `GET /admin/agents`. */
export class AdminAgentsListQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  is_active?: string;
}

/** Query for `GET /admin/jobs`. */
export class AdminJobsListQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agent_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  is_active?: string;
}

/** Query for `GET /admin/jobs/executions`. */
export class AdminJobExecutionsListQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  job_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

/** Query for `GET /admin/config-files`. */
export class AdminConfigFilesListQueryDto extends PaginatedQueryDto {}

/** Query for `GET /admin/config-files/file`. */
export class ConfigFilePathQueryDto {
  @ApiProperty({ maxLength: 2048 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  path!: string;
}

/** Mirrors agent-admin-service's `QuerySKBDto`. */
export class QueryStructuredKbDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsInt()
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsInt()
  @IsOptional()
  offset?: number;
}

export class MemoryIdParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class AdminMemoryListQueryDto {
  @ApiPropertyOptional({ enum: MemoryScope })
  @IsEnum(MemoryScope)
  @IsOptional()
  scope?: MemoryScope;

  @ApiPropertyOptional({ enum: MemoryKind })
  @IsEnum(MemoryKind)
  @IsOptional()
  kind?: MemoryKind;

  @ApiPropertyOptional({ enum: MemoryStatus })
  @IsEnum(MemoryStatus)
  @IsOptional()
  status?: MemoryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  offset?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true" || value === true) {
      return true;
    }
    if (value === "false" || value === false) {
      return false;
    }
    return undefined;
  })
  @IsBoolean()
  includeExpired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  context?: string;
}

export class CreateMemoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  scope!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  kind!: string;

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  title?: string;

  @ApiProperty({ maxLength: MAX_MEMORY_CONTENT_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MEMORY_CONTENT_LENGTH)
  content!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  topicKey?: string;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_NAME_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: MAX_MEMORY_CONTENT_LENGTH })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_MEMORY_CONTENT_LENGTH)
  content?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  topicKey?: string;
}
