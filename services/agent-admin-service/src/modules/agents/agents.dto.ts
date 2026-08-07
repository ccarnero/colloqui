import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  system_prompt!: string;

  @IsObject()
  @IsOptional()
  @Type(() => Object)
  model_config?: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  tools?: unknown[];

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  channels?: unknown[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  knowledge_base_ids?: string[];

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  input_variables?: unknown[];

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  output_variables?: unknown[];
}

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  system_prompt?: string;

  @IsObject()
  @IsOptional()
  @Type(() => Object)
  model_config?: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  tools?: unknown[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_tools?: string[];

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  channels?: unknown[];

  @IsOptional()
  @IsIn(["draft", "published", "archived"])
  status?: "draft" | "published" | "archived";

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  knowledge_base_ids?: string[];

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  input_variables?: unknown[];

  @IsArray()
  @IsOptional()
  @Type(() => Object)
  output_variables?: unknown[];
}

export class UpdateEnabledToolsDto {
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_tools?: string[] | null;
}

/**
 * List of enabled MCP server NAMES (not ids) for an agent, `null` = all
 * servers enabled. Must be name-keyed to match `tool-bridge.service.ts`'s
 * `mergeMcpTools()`, which filters the runtime's name-keyed connected-server
 * map (and `enabled_mcp_tools`'s server-name keying below).
 */
export class UpdateEnabledMcpServersDto {
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  enabled_mcp_servers?: string[] | null;
}

/**
 * Per-tool MCP allowlist for an agent, keyed by MCP server name
 * (mcp-connections.md §4). A value of `null` for a server means "all tools
 * from that server enabled" (backward-compatible default); an array is an
 * explicit allowlist of tool names within that server.
 */
export class UpdateEnabledMcpToolsDto {
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
  @IsObject()
  @IsOptional()
  tool_description_overrides?: Record<string, string> | null;
}

export class ListAgentsQueryDto extends PaginatedQueryDto {
  @IsOptional()
  @IsIn(["draft", "published", "archived"])
  status?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
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

/**
 * Chat API response shape. Outgoing responses are not validated by
 * ValidationPipe; use this class for typing and OpenAPI documentation only.
 */
export class ChatResponseDto {
  reply!: string;
  tool_calls?: unknown[];
}

export class MemoryProposalParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class MemoryProposalDto {
  id!: string;
  kind?: string;
  title?: string;
  content_excerpt?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export class MemoryProposalListResponseDto {
  proposals!: MemoryProposalDto[];
}

export class MemoryProposalActionResponseDto {
  success!: boolean;
  proposal?: MemoryProposalDto;
}
