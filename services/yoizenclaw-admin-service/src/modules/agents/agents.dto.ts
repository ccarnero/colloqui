import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsArray,
  IsBoolean,
  IsIn,
  Length,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginatedQueryDto } from "@yoizen/shared";

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
  @Type(() => Array)
  tools?: unknown[];

  @IsArray()
  @IsOptional()
  @Type(() => Array)
  channels?: unknown[];
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
  @Type(() => Array)
  tools?: unknown[];

  @IsArray()
  @IsOptional()
  @Type(() => Array)
  channels?: unknown[];

  @IsOptional()
  @IsIn(["draft", "published", "archived"])
  status?: "draft" | "published" | "archived";

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
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

  @IsArray()
  @IsOptional()
  @Type(() => Array)
  context?: Array<{ sender: "customer" | "agent"; content: string }>;
}

/**
 * Chat API response shape. Outgoing responses are not validated by
 * ValidationPipe; use this class for typing and OpenAPI documentation only.
 */
export class ChatResponseDto {
  reply!: string;
  tool_calls?: unknown[];
}
