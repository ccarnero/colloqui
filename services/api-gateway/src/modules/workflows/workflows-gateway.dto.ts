import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { WorkflowStatus, type WorkflowStatusValue } from "@yoizen/shared";
import { IsEnum, IsNumber, IsObject, IsOptional } from "class-validator";

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

/** Mirrors workflow-service PATCH /workflows/:id/status body. */
export class UpdateWorkflowStatusGatewayDto {
  @ApiProperty({ enum: Object.values(WorkflowStatus) })
  @IsEnum(WorkflowStatus)
  status!: WorkflowStatusValue;
}
