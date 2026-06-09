import { IsString, IsNotEmpty, IsOptional, IsIn } from "class-validator";
import type { VariableType } from "@yoizen/shared";

export class CreateSystemVariableDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsIn(["string", "number", "boolean", "json", "array", "secret"])
  type!: VariableType;

  @IsNotEmpty()
  value!: unknown;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateSystemVariableDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsIn(["string", "number", "boolean", "json", "array", "secret"])
  @IsOptional()
  type?: VariableType;

  @IsOptional()
  value?: unknown;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
