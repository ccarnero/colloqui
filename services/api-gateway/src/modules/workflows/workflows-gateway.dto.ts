import {
  IsArray,
  ArrayNotEmpty,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/** Mirrors workflow-service create body for gateway validation. */
export class CreateWorkflowGatewayDto {
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
  @IsObject({ each: true })
  actions!: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;
}

/** Mirrors workflow-service update body for gateway validation. */
export class UpdateWorkflowGatewayDto {
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
  @IsObject({ each: true })
  actions!: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;
}

/** Mirrors workflow-service execute body. */
export class ExecuteWorkflowGatewayDto {
  @IsObject()
  request!: Record<string, unknown>;
}
