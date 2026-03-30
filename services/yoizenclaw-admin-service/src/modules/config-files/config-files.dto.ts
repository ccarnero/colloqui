import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  Length,
  IsInt,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsEnum(['yaml', 'json'])
  @IsNotEmpty()
  format!: 'yaml' | 'json';
}

export class UpdateConfigFileDto {
  @IsString()
  @IsOptional()
  @Length(1, 255)
  name?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  is_active?: boolean;
}

export class ListConfigFilesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class GetConfigFileByPathQueryDto {
  @IsString()
  @IsNotEmpty()
  path!: string;
}

export class DeployConfigFilesDto {
  @IsOptional()
  @IsString({ each: true })
  deletePaths?: string[];
}
