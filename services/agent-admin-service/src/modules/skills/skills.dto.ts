import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  Min,
  Max,
  Length,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginatedQueryDto } from "@yoizen/shared/dto/pagination";

export class SkillFileDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsIn(["script", "reference", "asset"])
  type!: "script" | "reference" | "asset";

  @IsString()
  content!: string;
}

export class CreateSkillDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  system_prompt!: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  trigger_commands?: string[];

  @IsString()
  @IsOptional()
  when_to_use?: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  priority?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowed_tools?: string[];

  @IsString()
  @IsOptional()
  @IsIn(["router", "llm_driven", "inline"])
  mode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  @IsOptional()
  files?: SkillFileDto[];
}

export class UpdateSkillDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  system_prompt?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  trigger_commands?: string[];

  @IsString()
  @IsOptional()
  when_to_use?: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  priority?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowed_tools?: string[];

  @IsString()
  @IsOptional()
  @IsIn(["router", "llm_driven", "inline"])
  mode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkillFileDto)
  @IsOptional()
  files?: SkillFileDto[];

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class ListSkillsQueryDto extends PaginatedQueryDto {}
