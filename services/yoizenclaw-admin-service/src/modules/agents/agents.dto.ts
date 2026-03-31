import {
  IsString,
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsIn,
  IsObject,
  IsArray,
  IsBoolean,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdapterReferenceDto {
  @IsString()
  @IsNotEmpty()
  adapterId!: string;

  @IsString()
  @IsNotEmpty()
  endpointId!: string;
}

export class AgentToolDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsIn(['GET', 'POST', 'PUT', 'DELETE'])
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';

  @IsOptional()
  @ValidateNested()
  @Type(() => AdapterReferenceDto)
  adapterRef?: AdapterReferenceDto;

  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Validates that each tool in the array has exactly one of
 * `endpoint` or `adapterRef` — never both and never neither.
 *
 * Returns an array of error messages (empty when valid).
 */
export async function validateToolSourceExclusion(
  tools: unknown[],
): Promise<string[]> {
  const errors: string[] = [];
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i] as Record<string, unknown>;
    const hasEndpoint = Boolean(tool.endpoint);
    const hasAdapterRef = Boolean(tool.adapterRef);
    if (hasEndpoint && hasAdapterRef) {
      errors.push(
        `Tool at index ${i}: must have either endpoint OR adapterRef, not both`,
      );
    }
    if (!hasEndpoint && !hasAdapterRef) {
      errors.push(
        `Tool at index ${i}: must have either endpoint OR adapterRef`,
      );
    }
  }
  return errors;
}

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

  @IsString()
  @IsOptional()
  status?: 'draft' | 'published' | 'archived';

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class ListAgentsQueryDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  offset?: number;
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
  context?: Array<{ sender: 'customer' | 'agent'; content: string }>;
}

export class ChatResponseDto {
  reply!: string;
  tool_calls?: unknown[];
}
