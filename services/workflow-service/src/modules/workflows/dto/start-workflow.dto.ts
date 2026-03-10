import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsArray,
  MaxLength,
} from 'class-validator';

export class StartWorkflowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  application!: string;

  @IsObject()
  request!: Record<string, unknown>;

  @IsArray()
  actions!: unknown[];
}
