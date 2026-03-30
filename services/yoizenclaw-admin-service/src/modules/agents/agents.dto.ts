import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsArray,
  IsBoolean,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

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
