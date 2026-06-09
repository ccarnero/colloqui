import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  MaxLength,
  ArrayNotEmpty,
  Validate,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import type { WorkflowAction } from "@yoizen/shared";
import { IsWorkflowActionArrayConstraint } from "./workflow-action.validator";
import { WorkflowTriggerDto } from "./workflow-trigger.dto";

export class UpdateWorkflowDto {
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

  @IsOptional()
  variables?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowTriggerDto)
  trigger?: WorkflowTriggerDto;
}
