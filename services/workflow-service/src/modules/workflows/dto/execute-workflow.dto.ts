import { IsObject } from "class-validator";

export class ExecuteWorkflowDto {
  @IsObject()
  request!: Record<string, unknown>;
}
