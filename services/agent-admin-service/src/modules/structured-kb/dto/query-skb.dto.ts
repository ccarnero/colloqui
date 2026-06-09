import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max, IsArray } from "class-validator";

export class QuerySKBDto {
  @IsString()
  @IsNotEmpty()
  query!: string;

  @IsArray()
  @IsOptional()
  categories?: string[];

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  offset?: number;
}
