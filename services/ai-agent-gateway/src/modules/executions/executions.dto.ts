import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

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

  /**
   * Free-form, pass-through metadata. `submitExecution` hands the validated
   * DTO straight to `YoizenClawExecutionClient.submitExecution`, which places
   * it verbatim at `request.input` of the published `execution_requested`
   * envelope — so agent-ai-service's handler reads it back as
   * `input.metadata` (`execution.handler.ts`). Declared here only so the
   * global ValidationPipe (`whitelist` + `forbidNonWhitelisted`) stops
   * rejecting it with "property metadata should not exist"; nothing in this
   * service interprets its contents.
   *
   * Current consumer: the dev-only deterministic delay hook's
   * `__test_delay_ms` fallback key (manual-loops/agents/
   * long-running-agent-executions.md T03, human amendment 2026-07-30),
   * itself gated OFF unless `AGENT_TEST_DELAY_ENABLED=true`.
   */
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
