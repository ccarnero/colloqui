import { WorkflowStatus, type WorkflowStatusValue } from "@yoizen/shared";
import { IsEnum } from "class-validator";

export class UpdateWorkflowStatusDto {
  @IsEnum(WorkflowStatus)
  status!: WorkflowStatusValue;
}
