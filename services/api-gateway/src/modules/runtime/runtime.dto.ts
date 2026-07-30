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
   * Free-form, pass-through metadata forwarded verbatim to ai-agent-gateway
   * and from there into the `execution_requested` input (agent-ai-service
   * reads it as `input.metadata`). Declared so the global ValidationPipe
   * (`whitelist` + `forbidNonWhitelisted`) neither strips nor 400s it — a
   * caller-supplied bag of keys, never interpreted here.
   *
   * Current consumer: the dev-only deterministic delay hook's
   * `__test_delay_ms` fallback key (manual-loops/agents/
   * long-running-agent-executions.md T03, human amendment 2026-07-30;
   * `services/agent-ai-service/src/nats-handlers/test-delay.ts`), which is
   * itself gated OFF unless `AGENT_TEST_DELAY_ENABLED=true`.
   */
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
