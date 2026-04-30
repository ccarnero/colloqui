import { IsObject } from "class-validator";

/** Mirrors workflow-service execute body. */
export class ExecuteWorkflowGatewayDto {
  @IsObject()
  request!: Record<string, unknown>;
}
