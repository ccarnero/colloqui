import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsObject,
  IsOptional,
  IsUrl,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class AdapterRefDto {
  @IsString()
  @IsNotEmpty()
  adapterId!: string;

  @IsString()
  @IsNotEmpty()
  endpointId!: string;
}

export class EventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  type!: string;

  @IsObject()
  @IsNotEmpty()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ require_tld: false })
  callbackUrl?: string;

  @IsOptional()
  @IsString()
  adapterId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdapterRefDto)
  enrichAdapter?: AdapterRefDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdapterRefDto)
  forwardAdapter?: AdapterRefDto;
}
