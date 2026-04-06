import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsArray,
  Length,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginatedQueryDto } from "@yoizen/shared";

export class CreateConfigFileDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsEnum(["yaml", "json"])
  @IsNotEmpty()
  format!: "yaml" | "json";
}

export class ListConfigFilesQueryDto extends PaginatedQueryDto {}

export class GetConfigFileByPathQueryDto {
  @IsString()
  @IsNotEmpty()
  path!: string;
}

export class DeployConfigFilesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletePaths?: string[];
}
