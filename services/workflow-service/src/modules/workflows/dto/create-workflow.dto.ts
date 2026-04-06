import {
  IsString,
  IsNotEmpty,
  IsArray,
  MaxLength,
  ArrayNotEmpty,
  Validate,
} from "class-validator";
import type { WorkflowAction } from "@yoizen/shared";
import { IsWorkflowActionArrayConstraint } from "./workflow-action.validator";

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  application!: string;

  @IsArray()
  @ArrayNotEmpty()
  @Validate(IsWorkflowActionArrayConstraint)
  actions!: WorkflowAction[];
}
