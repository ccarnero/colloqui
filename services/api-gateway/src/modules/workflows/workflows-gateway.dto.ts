import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsObject, IsOptional } from "class-validator";

/** Mirrors workflow-service execute body. */
export class ExecuteWorkflowGatewayDto {
  @ApiProperty({ type: "object", additionalProperties: true })
  @IsObject()
  request!: Record<string, unknown>;

  /**
   * Optional agent call timeout in seconds. When set, overrides the
   * default agent call timeout for this execution.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  agentTimeoutSec?: number;
}
