import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const MAX_REASON_LENGTH = 2000;

export class ListMemoryProposalsQueryDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  kind?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class MemoryProposalParamDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class MemoryDecisionDto {
  @IsString()
  @IsOptional()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}

export class MemoryProposalDto {
  id!: string;
  kind?: string;
  title?: string;
  content_excerpt?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  agent_id?: string;
  source_chat_id?: string;
  source_user_id?: string;
}

export class MemoryProposalListResponseDto {
  proposals!: MemoryProposalDto[];
}

export class MemoryProposalActionResponseDto {
  success!: boolean;
  proposal?: MemoryProposalDto;
}
