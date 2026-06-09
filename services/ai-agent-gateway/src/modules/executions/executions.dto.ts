import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ExecutionContextEntryDto {
  @IsString()
  @IsIn(["customer", "agent"])
  sender!: "customer" | "agent";

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class CreateExecutionDto {
  @IsUUID()
  agentId!: string;

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
  @Type(() => ExecutionContextEntryDto)
  context?: ExecutionContextEntryDto[];
}
