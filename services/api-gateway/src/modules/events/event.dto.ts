import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsObject,
  IsOptional,
  IsUrl,
  Matches,
} from 'class-validator';

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
}
