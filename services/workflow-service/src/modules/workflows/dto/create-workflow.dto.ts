import {
  IsString,
  IsNotEmpty,
  IsArray,
  MaxLength,
} from "class-validator";

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
  actions!: unknown[];
}
