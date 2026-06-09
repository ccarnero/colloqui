import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class CreateSKBDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
