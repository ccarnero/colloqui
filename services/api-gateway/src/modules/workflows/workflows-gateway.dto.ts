import { IsObject, IsOptional, IsNumber } from "class-validator";

/** Mirrors workflow-service execute body. */
export class ExecuteWorkflowGatewayDto {
  @IsObject()
  request!: Record<string, unknown>;

  /**
   * Optional agent call timeout in seconds. When set, overrides the
   * default agent call timeout for this execution.
   */
  @IsOptional()
  @IsNumber()
  agentTimeoutSec?: number;
}
