import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  MaxLength,
  Matches,
  ArrayMinSize,
} from 'class-validator';

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof VALID_METHODS)[number];

export class CreateRouteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^\//, { message: 'path_prefix must start with /' })
  pathPrefix!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  methods?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  stripPrefix?: boolean;
}
